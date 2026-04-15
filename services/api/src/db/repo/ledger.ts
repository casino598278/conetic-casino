import type { Statement } from "better-sqlite3";
import { db, txn } from "../sqlite.js";

export type LedgerReason =
  | "deposit"
  | "bet"
  | "win"
  | "rake"
  | "refund"
  | "withdraw"
  | "withdraw_fee"
  | "bonus";

export interface LedgerEntry {
  id: number;
  user_id: string;
  chain_id: string;
  delta_nano: string;
  reason: LedgerReason;
  ref_id: string | null;
  round_id: number | null;
  created_at: number;
}

// Lazy-prepared so migrations run before statements are compiled.
let _insertEntry: Statement | null = null;
let _sumBalance: Statement | null = null;
function insertEntry(): Statement {
  if (!_insertEntry) {
    _insertEntry = db.prepare(
      `INSERT INTO ledger_entries (user_id, chain_id, delta_nano, reason, ref_id, round_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
  }
  return _insertEntry;
}
function sumBalance(): Statement {
  if (!_sumBalance) {
    _sumBalance = db.prepare(
      `SELECT COALESCE(SUM(CAST(delta_nano AS INTEGER)), 0) AS bal
       FROM ledger_entries WHERE user_id = ? AND chain_id = ?`,
    );
  }
  return _sumBalance;
}

/** Get balance in nano-units (uses SQLite int64 SUM — safe for amounts < 2^63). */
export function getBalanceNano(userId: string, chainId = "ton"): bigint {
  const row = sumBalance().get(userId, chainId) as { bal: number | bigint };
  return BigInt(row.bal);
}

/** Append a credit. Must be called from within a txn() if part of a multi-step op. */
export function credit(input: {
  userId: string;
  chainId?: string;
  amountNano: bigint;
  reason: LedgerReason;
  refId?: string | null;
  roundId?: number | null;
}): void {
  if (input.amountNano <= 0n) throw new Error(`credit amount must be positive, got ${input.amountNano}`);
  insertEntry().run(
    input.userId,
    input.chainId ?? "ton",
    input.amountNano.toString(),
    input.reason,
    input.refId ?? null,
    input.roundId ?? null,
    Date.now(),
  );
}

/** Append a debit. Atomically checks balance >= amount inside a transaction. */
export function debit(input: {
  userId: string;
  chainId?: string;
  amountNano: bigint;
  reason: LedgerReason;
  refId?: string | null;
  roundId?: number | null;
}): void {
  if (input.amountNano <= 0n) throw new Error(`debit amount must be positive, got ${input.amountNano}`);
  const chainId = input.chainId ?? "ton";
  txn(() => {
    const bal = getBalanceNano(input.userId, chainId);
    if (bal < input.amountNano) {
      throw new InsufficientBalanceError(input.userId, bal, input.amountNano);
    }
    insertEntry().run(
      input.userId,
      chainId,
      (-input.amountNano).toString(),
      input.reason,
      input.refId ?? null,
      input.roundId ?? null,
      Date.now(),
    );
  });
}

export class InsufficientBalanceError extends Error {
  constructor(userId: string, available: bigint, requested: bigint) {
    super(`insufficient balance: user=${userId} available=${available} requested=${requested}`);
    this.name = "InsufficientBalanceError";
  }
}
