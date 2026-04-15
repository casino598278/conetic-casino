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
import { txn } from "../db/sqlite.js";
import { credit, debit, InsufficientBalanceError } from "../db/repo/ledger.js";
import {
  createRound,
  findUnresolvedRounds,
  getBetsForRound,
  getOrInsertBet,
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
      error: "phase_closed" | "insufficient_balance" | "below_min" | "above_max" | "duplicate";
    };

/**
 * Single global lobby state machine: IDLE → COUNTDOWN → LIVE → RESOLVED → IDLE.
 * Server is authoritative on phase + outcome; clients receive snapshots over WS.
 */
export class GameEngine extends EventEmitter {
  private currentRoundId: number | null = null;
  private phase: "IDLE" | "COUNTDOWN" | "LIVE" | "RESOLVED" = "IDLE";
  private countdownTimer: NodeJS.Timeout | null = null;
  private liveTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;

  start() {
    ensureHouseUser();
    // On boot: refund any unresolved rounds.
    for (const r of findUnresolvedRounds()) this.refundRound(r);
    this.scheduleNextRound();
    this.tickTimer = setInterval(() => this.emit("tick", this.getSnapshot()), 250);
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
        phase: "IDLE",
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
      countdownEndsAt: round.countdown_ends_at,
      serverSeedHash: round.server_seed_hash,
    };
  }

  /** Place a bet during COUNTDOWN (until T - BET_LOCK_BUFFER_MS). */
  placeBet(input: {
    userId: string;
    amountNano: bigint;
    clientSeedHex: string;
  }): JoinResult {
    if (this.phase !== "COUNTDOWN" || this.currentRoundId == null) {
      return { ok: false, error: "phase_closed" };
    }
    const round = getRound(this.currentRoundId);
    if (!round || round.countdown_ends_at == null) {
      return { ok: false, error: "phase_closed" };
    }
    if (Date.now() > round.countdown_ends_at - BET_LOCK_BUFFER_MS) {
      return { ok: false, error: "phase_closed" };
    }

    const minNano = BigInt(Math.floor(config.MIN_BET_TON * 1e9));
    const maxNano = BigInt(Math.floor(config.MAX_BET_TON * 1e9));
    if (input.amountNano < minNano) return { ok: false, error: "below_min" };
    if (input.amountNano > maxNano) return { ok: false, error: "above_max" };

    try {
      txn(() => {
        // Reject duplicate bet from same user in same round.
        const existing = getBetsForRound(round.id).find((b) => b.user_id === input.userId);
        if (existing) throw new DuplicateBetError();

        debit({
          userId: input.userId,
          amountNano: input.amountNano,
          reason: "bet",
          roundId: round.id,
        });
        getOrInsertBet({
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
      if (err instanceof DuplicateBetError) return { ok: false, error: "duplicate" };
      throw err;
    }

    const snapshot = this.getSnapshot();
    this.emit("playerJoined", snapshot);
    return { ok: true, snapshot };
  }

  // --- internals ---

  private scheduleNextRound() {
    const serverSeedHex = generateServerSeed();
    const serverSeedHash = sha256Hex(serverSeedHex);
    const countdownMs = config.COUNTDOWN_SECONDS * 1000;
    const countdownEndsAt = Date.now() + countdownMs;
    const round = createRound({ serverSeedHex, serverSeedHash, countdownEndsAt });
    this.currentRoundId = round.id;
    this.phase = "COUNTDOWN";
    this.emit("roundCommit", {
      roundId: round.id,
      serverSeedHash,
      countdownEndsAt,
    });
    this.emit("snapshot", this.getSnapshot());

    this.countdownTimer = setTimeout(() => this.startLive(), countdownMs);
  }

  private async startLive() {
    if (!this.currentRoundId) return;
    const round = getRound(this.currentRoundId)!;
    const bets = getBetsForRound(round.id);

    if (bets.length < 2) {
      // Not enough players. Refund any single-player bet, reset.
      this.refundRound(round);
      this.currentRoundId = null;
      this.phase = "IDLE";
      this.emit("snapshot", this.getSnapshot());
      // Brief pause then start a fresh round.
      setTimeout(() => this.scheduleNextRound(), 1500);
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
      this.phase = "IDLE";
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

class DuplicateBetError extends Error {
  constructor() {
    super("duplicate bet");
    this.name = "DuplicateBetError";
  }
}

export const engine = new GameEngine();
