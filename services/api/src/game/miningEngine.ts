import { EventEmitter } from "node:events";
import {
  ARENA,
  MINING,
  type MiningSnapshot,
  type MiningResultEvent,
  type PlayerEntry,
  deriveMiningSeed,
  simulateMining,
  hmacSha256,
  bufToHex,
} from "@conetic/shared";
import { config } from "../config.js";
import { db, txn } from "../db/sqlite.js";
import { credit, debit, getBalanceNano, InsufficientBalanceError } from "../db/repo/ledger.js";
import {
  countResolvedMiningRounds,
  createMiningRound,
  findUnresolvedMiningRounds,
  getMiningBetsForRound,
  getMiningRound,
  markMiningLive,
  markMiningRefunded,
  markMiningResolved,
  setMiningCountdown,
  upsertMiningBet,
  updateMiningPot,
  type MiningRoundRow,
} from "../db/repo/mining.js";
import { getHouseUserId, getUserById, getPublicIdentity } from "../db/repo/users.js";
import { addWager } from "../db/repo/leaderboard.js";
import { generateServerSeed, sha256Hex } from "./fair.js";
import { notifyUser } from "../bot.js";

const NANO = 1_000_000_000n;
const COUNTDOWN_MS = 15_000;        // 15s waiting countdown
const WAITING_TIMEOUT_MS = 5 * 60 * 1000;
const BET_LOCK_BUFFER_MS = 1500;
const BET_RATE_WINDOW_MS = 10000;
const BET_RATE_MAX = 5;
const betRateMap = new Map<string, number[]>();

function checkBetRate(userId: string): boolean {
  const now = Date.now();
  const stamps = betRateMap.get(userId) ?? [];
  const recent = stamps.filter((t) => now - t < BET_RATE_WINDOW_MS);
  if (recent.length >= BET_RATE_MAX) return false;
  recent.push(now);
  betRateMap.set(userId, recent);
  return true;
}

function fmtNano(n: bigint): string {
  const w = n / NANO;
  const f = (n % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

export type MiningJoinResult =
  | { ok: true; snapshot: MiningSnapshot }
  | { ok: false; error: "phase_closed" | "insufficient_balance" | "below_min" | "above_max" };

export class MiningEngine extends EventEmitter {
  private currentRoundId: number | null = null;
  private phase: "WAITING" | "COUNTDOWN" | "LIVE" | "RESOLVED" = "WAITING";
  private countdownTimer: NodeJS.Timeout | null = null;
  private liveTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private waitingTimeout: NodeJS.Timeout | null = null;

  start() {
    for (const r of findUnresolvedMiningRounds()) {
      console.log(`[mining] refunding stale round ${r.id} (status=${r.status})`);
      this.refundRound(r);
    }
    this.scheduleNextRound();
    this.tickTimer = setInterval(() => {
      if (this.phase !== "COUNTDOWN" || !this.currentRoundId) return;
      const r = getMiningRound(this.currentRoundId);
      if (!r) return;
      this.emit("tickLite", { countdownEndsAt: r.countdown_ends_at });
    }, 500);
    console.log("[mining] started");
  }

  stop() {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    if (this.liveTimer) clearTimeout(this.liveTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.cancelWaitingTimeout();
  }

  getSnapshot(): MiningSnapshot {
    const displayId = countResolvedMiningRounds() + 1;
    if (!this.currentRoundId) {
      return {
        roundId: 0,
        displayId,
        phase: "WAITING",
        players: [],
        potNano: "0",
        countdownEndsAt: null,
        serverSeedHash: null,
      };
    }
    const round = getMiningRound(this.currentRoundId)!;
    const players = this.playersForRound(round);
    return {
      roundId: round.id,
      displayId,
      phase: this.phase,
      players,
      potNano: round.pot_nano,
      countdownEndsAt: this.phase === "COUNTDOWN" ? round.countdown_ends_at : null,
      serverSeedHash: round.server_seed_hash,
    };
  }

  placeBet(input: { userId: string; amountNano: bigint; clientSeedHex: string }): MiningJoinResult {
    if (this.currentRoundId == null) return { ok: false, error: "phase_closed" };
    if (this.phase !== "WAITING" && this.phase !== "COUNTDOWN") return { ok: false, error: "phase_closed" };
    const round = getMiningRound(this.currentRoundId);
    if (!round) return { ok: false, error: "phase_closed" };
    if (
      this.phase === "COUNTDOWN" &&
      round.countdown_ends_at != null &&
      Date.now() > round.countdown_ends_at - BET_LOCK_BUFFER_MS
    ) {
      return { ok: false, error: "phase_closed" };
    }
    if (!checkBetRate(input.userId)) return { ok: false, error: "phase_closed" };

    const minNano = BigInt(Math.floor(config.MIN_BET_TON * 1e9));
    const maxNano = BigInt(Math.floor(config.MAX_BET_TON * 1e9));
    if (input.amountNano < minNano) return { ok: false, error: "below_min" };
    if (input.amountNano > maxNano) return { ok: false, error: "above_max" };

    try {
      txn(() => {
        debit({ userId: input.userId, amountNano: input.amountNano, reason: "bet", roundId: round.id });
        upsertMiningBet({
          roundId: round.id,
          userId: input.userId,
          amountNano: input.amountNano,
          clientSeedHex: input.clientSeedHex,
        });
        const newPot = BigInt(round.pot_nano) + input.amountNano;
        updateMiningPot(round.id, newPot);
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) return { ok: false, error: "insufficient_balance" };
      throw err;
    }

    addWager(input.userId, input.amountNano);
    this.emit("balanceChanged", { userId: input.userId, balanceNano: getBalanceNano(input.userId) });

    if (this.phase === "WAITING") {
      const bets = getMiningBetsForRound(this.currentRoundId!);
      if (bets.length >= 2) {
        this.cancelWaitingTimeout();
        this.beginCountdown();
      } else if (bets.length === 1 && !this.waitingTimeout) {
        this.waitingTimeout = setTimeout(() => this.refundWaitingRound(), WAITING_TIMEOUT_MS);
      }
    }

    const snapshot = this.getSnapshot();
    this.emit("playerJoined", snapshot);
    return { ok: true, snapshot };
  }

  private cancelWaitingTimeout() {
    if (this.waitingTimeout) {
      clearTimeout(this.waitingTimeout);
      this.waitingTimeout = null;
    }
  }

  private refundWaitingRound() {
    this.waitingTimeout = null;
    if (!this.currentRoundId || this.phase !== "WAITING") return;
    const round = getMiningRound(this.currentRoundId);
    if (!round) return;
    const bets = getMiningBetsForRound(round.id);
    if (bets.length >= 2) return;
    console.log(`[mining] round ${round.id} waiting timeout — refunding`);
    this.refundRound(round);
    for (const b of bets) {
      const u = getUserById(b.user_id);
      if (u) {
        notifyUser(u.tg_id, `Mining round expired (no 2nd player). Refunded ${fmtNano(BigInt(b.amount_nano))} TON.`).catch(() => {});
      }
    }
    this.currentRoundId = null;
    this.phase = "WAITING";
    this.emit("snapshot", this.getSnapshot());
    this.scheduleNextRound();
  }

  private scheduleNextRound() {
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    const serverSeedHex = generateServerSeed();
    const serverSeedHash = sha256Hex(serverSeedHex);
    const round = createMiningRound({
      serverSeedHex,
      serverSeedHash,
      countdownEndsAt: Date.now() + COUNTDOWN_MS,
    });
    this.currentRoundId = round.id;
    this.phase = "WAITING";
    this.emit("roundCommit", { roundId: round.id, serverSeedHash, countdownEndsAt: 0 });
    this.emit("snapshot", this.getSnapshot());
  }

  private beginCountdown() {
    if (this.phase !== "WAITING" || this.currentRoundId == null) return;
    const endsAt = Date.now() + COUNTDOWN_MS;
    setMiningCountdown(this.currentRoundId, endsAt);
    this.phase = "COUNTDOWN";
    const r = getMiningRound(this.currentRoundId)!;
    console.log(`[mining] round ${r.id} countdown started`);
    this.emit("roundCommit", { roundId: r.id, serverSeedHash: r.server_seed_hash, countdownEndsAt: endsAt });
    this.emit("snapshot", this.getSnapshot());
    this.countdownTimer = setTimeout(() => this.startLive(), COUNTDOWN_MS);
  }

  private async startLive() {
    if (!this.currentRoundId) return;
    const round = getMiningRound(this.currentRoundId)!;
    const bets = getMiningBetsForRound(round.id);
    if (bets.length < 2) {
      this.refundRound(round);
      this.currentRoundId = null;
      this.phase = "WAITING";
      this.emit("snapshot", this.getSnapshot());
      setTimeout(() => this.scheduleNextRound(), 1000);
      return;
    }

    // Derive trajectory seed = HMAC(serverSeed, sorted clientSeeds + roundId).
    const sortedSeeds = bets.map((b) => b.client_seed_hex).sort();
    const combined = `${sortedSeeds.join(":")}:${round.id}`;
    const mac = await hmacSha256(round.server_seed_hex, combined);
    const trajectorySeedHex = bufToHex(mac);

    markMiningLive(round.id, trajectorySeedHex);
    this.phase = "LIVE";
    this.emit("roundLive", { roundId: round.id, trajectorySeedHex, startedAt: Date.now() });

    this.liveTimer = setTimeout(() => this.resolveRound(round.id, trajectorySeedHex), MINING.DURATION_MS + 500);
  }

  private async resolveRound(roundId: number, trajectorySeedHex: string) {
    const round = getMiningRound(roundId);
    if (!round || round.status !== "LIVE") return;
    const bets = getMiningBetsForRound(roundId);
    if (bets.length < 2) {
      this.refundRound(round);
      this.afterRound();
      return;
    }

    const sortedBets = [...bets].sort((a, b) => (a.user_id < b.user_id ? -1 : 1));
    const totalNano = BigInt(round.pot_nano);
    const stakeFractions = sortedBets.map((b) => Number(BigInt(b.amount_nano) * 1_000_000n / totalNano) / 1_000_000);
    const playerSeeds = await Promise.all(
      sortedBets.map((b, i) => deriveMiningSeed(round.server_seed_hex, b.client_seed_hex, i)),
    );
    const result = simulateMining(playerSeeds, stakeFractions, trajectorySeedHex);
    const winnerBet = sortedBets[result.winnerIndex]!;
    const potNano = BigInt(round.pot_nano);
    const winnerStake = BigInt(winnerBet.amount_nano);
    const profit = potNano - winnerStake;
    const rakeNano = profit > 0n ? (profit * BigInt(config.RAKE_BPS)) / BigInt(ARENA.BPS_DENOM) : 0n;
    const winnerPayoutNano = potNano - rakeNano;
    const houseId = getHouseUserId();

    const finalGems = sortedBets.map((b, i) => ({ userId: b.user_id, gems: result.finalGems[i]! }));

    txn(() => {
      credit({ userId: winnerBet.user_id, amountNano: winnerPayoutNano, reason: "win", roundId });
      if (rakeNano > 0n) {
        credit({ userId: houseId, amountNano: rakeNano, reason: "rake", roundId });
      }
      markMiningResolved({
        roundId,
        winnerUserId: winnerBet.user_id,
        winnerPayoutNano,
        rakeNano,
        finalGems,
      });
    });

    const winUser = getUserById(winnerBet.user_id);
    if (winUser) {
      notifyUser(winUser.tg_id, `You won mining round #${roundId} — +${fmtNano(winnerPayoutNano)} TON`).catch(() => {});
    }

    for (const b of sortedBets) {
      this.emit("balanceChanged", { userId: b.user_id, balanceNano: getBalanceNano(b.user_id) });
    }

    const event: MiningResultEvent = {
      roundId,
      winnerUserId: winnerBet.user_id,
      winnerPayoutNano: winnerPayoutNano.toString(),
      rakeNano: rakeNano.toString(),
      serverSeedHex: round.server_seed_hex,
      trajectorySeedHex,
      finalGems,
    };
    this.emit("roundResult", event);
    this.phase = "RESOLVED";
    this.afterRound();
  }

  private afterRound() {
    setTimeout(() => {
      this.currentRoundId = null;
      this.phase = "WAITING";
      this.scheduleNextRound();
    }, 4000);
  }

  private refundRound(round: MiningRoundRow) {
    const bets = getMiningBetsForRound(round.id);
    txn(() => {
      for (const b of bets) {
        credit({ userId: b.user_id, amountNano: BigInt(b.amount_nano), reason: "refund", roundId: round.id });
      }
      markMiningRefunded(round.id);
    });
  }

  private playersForRound(round: MiningRoundRow): PlayerEntry[] {
    const bets = getMiningBetsForRound(round.id);
    return bets.map((b) => {
      const u = getUserById(b.user_id)!;
      const pub = getPublicIdentity(u);
      return {
        userId: u.id,
        tgId: u.tg_id,
        username: pub.username,
        firstName: pub.firstName,
        photoUrl: pub.photoUrl,
        stakeNano: b.amount_nano,
        clientSeedHex: b.client_seed_hex,
      };
    });
  }
}

export const miningEngine = new MiningEngine();
