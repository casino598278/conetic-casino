import { EventEmitter } from "node:events";
import {
  ARENA,
  deriveOutcome,
  resolveWinner,
  type LobbySnapshot,
  type PlayerEntry,
  type RoundResult,
} from "@conetic/shared";
import { config } from "../config.js";
import { db, txn } from "../db/sqlite.js";
import { credit, debit, getBalanceNano, InsufficientBalanceError } from "../db/repo/ledger.js";
import {
  createRound,
  findUnresolvedRounds,
  getBetsForRound,
  upsertBet,
  getRound,
  markLive,
  markRefunded,
  markResolved,
  type RoundRow,
  updateRoundPot,
} from "../db/repo/rounds.js";
import { ensureHouseUser, getHouseUserId, getUserById } from "../db/repo/users.js";
import { generateServerSeed, sha256Hex } from "./fair.js";

const BET_LOCK_BUFFER_MS = 2000;

export type JoinResult =
  | { ok: true; snapshot: LobbySnapshot }
  | {
      ok: false;
      error: "phase_closed" | "insufficient_balance" | "below_min" | "above_max";
    };

/**
 * Single global lobby state machine: IDLE → COUNTDOWN → LIVE → RESOLVED → IDLE.
 * Server is authoritative on phase + outcome; clients receive snapshots over WS.
 */
export class GameEngine extends EventEmitter {
  private currentRoundId: number | null = null;
  private phase: "WAITING" | "COUNTDOWN" | "LIVE" | "RESOLVED" = "WAITING";
  private countdownTimer: NodeJS.Timeout | null = null;
  private liveTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;

  start() {
    ensureHouseUser();
    // On boot: refund any unresolved rounds (server crashed mid-round).
    const stale = findUnresolvedRounds();
    for (const r of stale) {
      console.log(`[engine] refunding stale round ${r.id} (status=${r.status})`);
      this.refundRound(r);
    }
    this.scheduleNextRound();
    // Tick is only needed so the client countdown animates smoothly.
    // Skip heavy snapshot query — just send the end timestamp.
    this.tickTimer = setInterval(() => {
      if (this.phase !== "COUNTDOWN" || !this.currentRoundId) return;
      const round = getRound(this.currentRoundId);
      if (!round) return;
      this.emit("tickLite", { countdownEndsAt: round.countdown_ends_at });
    }, 500);
    console.log("[engine] started");
  }

  stop() {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    if (this.liveTimer) clearTimeout(this.liveTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  getSnapshot(): LobbySnapshot {
    if (!this.currentRoundId) {
      return {
        roundId: 0,
        phase: "WAITING",
        players: [],
        potNano: "0",
        countdownEndsAt: null,
        serverSeedHash: null,
      };
    }
    const round = getRound(this.currentRoundId)!;
    const players = this.playersForRound(round);
    return {
      roundId: round.id,
      phase: this.phase,
      players,
      potNano: round.pot_nano,
      // Only expose endsAt during actual COUNTDOWN — null while WAITING.
      countdownEndsAt: this.phase === "COUNTDOWN" ? round.countdown_ends_at : null,
      serverSeedHash: round.server_seed_hash,
    };
  }

  /** Place a bet during WAITING or COUNTDOWN (locked at T - BET_LOCK_BUFFER_MS). */
  placeBet(input: {
    userId: string;
    amountNano: bigint;
    clientSeedHex: string;
  }): JoinResult {
    if (this.currentRoundId == null) {
      return { ok: false, error: "phase_closed" };
    }
    if (this.phase !== "WAITING" && this.phase !== "COUNTDOWN") {
      return { ok: false, error: "phase_closed" };
    }
    const round = getRound(this.currentRoundId);
    if (!round) return { ok: false, error: "phase_closed" };
    if (
      this.phase === "COUNTDOWN" &&
      round.countdown_ends_at != null &&
      Date.now() > round.countdown_ends_at - BET_LOCK_BUFFER_MS
    ) {
      return { ok: false, error: "phase_closed" };
    }

    const minNano = BigInt(Math.floor(config.MIN_BET_TON * 1e9));
    const maxNano = BigInt(Math.floor(config.MAX_BET_TON * 1e9));
    if (input.amountNano < minNano) return { ok: false, error: "below_min" };
    if (input.amountNano > maxNano) return { ok: false, error: "above_max" };

    try {
      txn(() => {
        debit({
          userId: input.userId,
          amountNano: input.amountNano,
          reason: "bet",
          roundId: round.id,
        });
        // Top up if user already has a stake this round (multi-bet support).
        upsertBet({
          roundId: round.id,
          userId: input.userId,
          amountNano: input.amountNano,
          clientSeedHex: input.clientSeedHex,
        });
        const newPot = BigInt(round.pot_nano) + input.amountNano;
        updateRoundPot(round.id, newPot);
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) return { ok: false, error: "insufficient_balance" };
      throw err;
    }

    // If we're in WAITING and this bet brings us to 2+ players, start the countdown.
    if (this.phase === "WAITING") {
      const bets = getBetsForRound(this.currentRoundId!);
      if (bets.length >= 2) {
        this.beginCountdown();
      }
    }

    // Push updated balance to the bettor.
    this.emit("balanceChanged", { userId: input.userId, balanceNano: getBalanceNano(input.userId) });

    const snapshot = this.getSnapshot();
    this.emit("playerJoined", snapshot);
    return { ok: true, snapshot };
  }

  // --- internals ---

  private scheduleNextRound() {
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    const serverSeedHex = generateServerSeed();
    const serverSeedHash = sha256Hex(serverSeedHex);
    // Created with a placeholder countdown_ends_at; only used once we hit COUNTDOWN.
    const round = createRound({
      serverSeedHex,
      serverSeedHash,
      countdownEndsAt: Date.now() + config.COUNTDOWN_SECONDS * 1000,
    });
    this.currentRoundId = round.id;
    this.phase = "WAITING";
    this.emit("roundCommit", {
      roundId: round.id,
      serverSeedHash,
      countdownEndsAt: 0, // 0 means waiting for players
    });
    this.emit("snapshot", this.getSnapshot());
  }

  /** Switch the current WAITING round into COUNTDOWN; called when 2nd player joins. */
  private beginCountdown() {
    if (this.phase !== "WAITING" || this.currentRoundId == null) return;
    const countdownMs = config.COUNTDOWN_SECONDS * 1000;
    const countdownEndsAt = Date.now() + countdownMs;
    // Update round row so getSnapshot exposes the deadline.
    const r = getRound(this.currentRoundId)!;
    db.prepare("UPDATE rounds SET countdown_ends_at = ? WHERE id = ?").run(
      countdownEndsAt,
      r.id,
    );
    this.phase = "COUNTDOWN";
    console.log(`[engine] round ${r.id} countdown started (${config.COUNTDOWN_SECONDS}s)`);
    this.emit("roundCommit", {
      roundId: r.id,
      serverSeedHash: r.server_seed_hash,
      countdownEndsAt,
    });
    this.emit("snapshot", this.getSnapshot());
    this.countdownTimer = setTimeout(() => this.startLive(), countdownMs);
  }

  private async startLive() {
    if (!this.currentRoundId) return;
    const round = getRound(this.currentRoundId)!;
    const bets = getBetsForRound(round.id);

    // Defensive: if a player left mid-countdown bringing us below 2, refund + reset.
    if (bets.length < 2) {
      this.refundRound(round);
      this.currentRoundId = null;
      this.phase = "WAITING";
      this.emit("snapshot", this.getSnapshot());
      setTimeout(() => this.scheduleNextRound(), 1000);
      return;
    }

    // Derive trajectory seed from server seed + sorted client seeds + roundId.
    const clientSeedsHex = bets.map((b) => b.client_seed_hex);
    const outcome = await deriveOutcome({
      serverSeedHex: round.server_seed_hex,
      clientSeedsHex,
      roundId: round.id,
    });
    const trajectorySeedHex = outcome.macHex;
    markLive(round.id, trajectorySeedHex);
    this.phase = "LIVE";
    this.emit("roundLive", {
      roundId: round.id,
      trajectorySeedHex,
      startedAt: Date.now(),
    });

    // Resolve after the simulation's max possible duration so client animation finishes.
    this.liveTimer = setTimeout(() => this.resolveRound(round.id, trajectorySeedHex), ARENA.MAX_SIM_MS + 500);
  }

  private resolveRound(roundId: number, trajectorySeedHex: string) {
    const round = getRound(roundId);
    if (!round || round.status !== "LIVE") return;
    const bets = getBetsForRound(roundId);
    if (bets.length < 2) {
      this.refundRound(round);
      this.afterRound();
      return;
    }
    const players: PlayerEntry[] = bets.map((b) => {
      const u = getUserById(b.user_id)!;
      return {
        userId: u.id,
        tgId: u.tg_id,
        username: u.username,
        firstName: u.first_name,
        photoUrl: u.photo_url,
        stakeNano: b.amount_nano,
        clientSeedHex: b.client_seed_hex,
      };
    });
    const potNano = BigInt(round.pot_nano);
    const { winner, result } = resolveWinner(trajectorySeedHex, players, potNano);

    const rakeNano = (potNano * BigInt(config.RAKE_BPS)) / BigInt(ARENA.BPS_DENOM);
    const winnerPayoutNano = potNano - rakeNano;
    const houseId = getHouseUserId();

    txn(() => {
      credit({
        userId: winner.userId,
        amountNano: winnerPayoutNano,
        reason: "win",
        roundId,
      });
      if (rakeNano > 0n) {
        credit({
          userId: houseId,
          amountNano: rakeNano,
          reason: "rake",
          roundId,
        });
      }
      markResolved({
        roundId,
        winnerUserId: winner.userId,
        winnerPayoutNano,
        rakeNano,
        restingX: result.resting.x,
        restingY: result.resting.y,
      });
    });

    // Push updated balances to all players in this round.
    for (const b of bets) {
      this.emit("balanceChanged", { userId: b.user_id, balanceNano: getBalanceNano(b.user_id) });
    }

    const resolved = getRound(roundId)!;
    const resultEvent: RoundResult = {
      roundId,
      winnerUserId: winner.userId,
      winnerPayoutNano: winnerPayoutNano.toString(),
      rakeNano: rakeNano.toString(),
      serverSeedHex: resolved.server_seed_hex,
      serverSeedHash: resolved.server_seed_hash,
      clientSeedsHex: bets.map((b) => b.client_seed_hex),
      macHex: trajectorySeedHex,
      trajectorySeedHex,
      restingX: result.resting.x,
      restingY: result.resting.y,
    };
    this.emit("roundResult", resultEvent);
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

  /** Refund all bet stakes via reverse ledger entries. */
  private refundRound(round: RoundRow) {
    const bets = getBetsForRound(round.id);
    txn(() => {
      for (const b of bets) {
        credit({
          userId: b.user_id,
          amountNano: BigInt(b.amount_nano),
          reason: "refund",
          roundId: round.id,
        });
      }
      markRefunded(round.id);
    });
  }

  private playersForRound(round: RoundRow): PlayerEntry[] {
    const bets = getBetsForRound(round.id);
    return bets.map((b) => {
      const u = getUserById(b.user_id)!;
      return {
        userId: u.id,
        tgId: u.tg_id,
        username: u.username,
        firstName: u.first_name,
        photoUrl: u.photo_url,
        stakeNano: b.amount_nano,
        clientSeedHex: b.client_seed_hex,
      };
    });
  }
}

export const engine = new GameEngine();
