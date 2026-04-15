import { db } from "../sqlite.js";

export interface WithdrawalRow {
  id: string;
  chain_id: string;
  user_id: string;
  to_address: string;
  amount_nano: string;
  fee_nano: string;
  status: "pending" | "sent" | "failed";
  tx_hash: string | null;
  idempotency_key: string;
  attempts: number;
  last_error: string | null;
  created_at: number;
  sent_at: number | null;
}

export function getCursor(chainId: string): string | null {
  const row = db.prepare("SELECT cursor FROM chain_cursors WHERE chain_id = ?").get(chainId) as
    | { cursor: string }
    | undefined;
  return row?.cursor ?? null;
}

export function setCursor(chainId: string, cursor: string) {
  db.prepare(
    `INSERT INTO chain_cursors (chain_id, cursor, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(chain_id) DO UPDATE SET cursor=excluded.cursor, updated_at=excluded.updated_at`,
  ).run(chainId, cursor, Date.now());
}

export function depositExists(chainId: string, txHash: string, lt: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM deposits WHERE chain_id = ? AND tx_hash = ? AND lt = ?")
    .get(chainId, txHash, lt);
  return !!row;
}

export function insertDeposit(input: {
  chainId: string;
  userId: string;
  txHash: string;
  lt: string;
  amountNano: bigint;
  memo: string | null;
  fromAddress: string | null;
}) {
  const id = `${input.chainId}:${input.txHash}:${input.lt}`;
  db.prepare(
    `INSERT INTO deposits (id, chain_id, user_id, tx_hash, lt, amount_nano, memo, from_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.chainId, input.userId, input.txHash, input.lt, input.amountNano.toString(),
       input.memo, input.fromAddress, Date.now());
  return id;
}

export function createWithdrawal(input: {
  id: string;
  chainId: string;
  userId: string;
  toAddress: string;
  amountNano: bigint;
  feeNano: bigint;
  idempotencyKey: string;
}): WithdrawalRow {
  db.prepare(
    `INSERT INTO withdrawals (id, chain_id, user_id, to_address, amount_nano, fee_nano,
                              status, idempotency_key, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`,
  ).run(input.id, input.chainId, input.userId, input.toAddress, input.amountNano.toString(),
       input.feeNano.toString(), input.idempotencyKey, Date.now());
  return db.prepare("SELECT * FROM withdrawals WHERE id = ?").get(input.id) as WithdrawalRow;
}

export function findWithdrawalByIdempotency(key: string): WithdrawalRow | null {
  return (db.prepare("SELECT * FROM withdrawals WHERE idempotency_key = ?").get(key) as
    | WithdrawalRow
    | undefined) ?? null;
}

export function pendingWithdrawals(): WithdrawalRow[] {
  return db
    .prepare("SELECT * FROM withdrawals WHERE status='pending' ORDER BY created_at ASC LIMIT 25")
    .all() as WithdrawalRow[];
}

export function markWithdrawalSent(id: string, txHash: string) {
  db.prepare("UPDATE withdrawals SET status='sent', tx_hash=?, sent_at=? WHERE id=?").run(
    txHash,
    Date.now(),
    id,
  );
}

export function markWithdrawalFailed(id: string, err: string) {
  db.prepare(
    "UPDATE withdrawals SET status='failed', last_error=?, attempts=attempts+1 WHERE id=?",
  ).run(err, id);
}

export function dailyWithdrawnNano(userId: string, chainId: string): bigint {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(amount_nano AS INTEGER)), 0) AS total
       FROM withdrawals WHERE user_id = ? AND chain_id = ? AND status IN ('pending','sent') AND created_at > ?`,
    )
    .get(userId, chainId, since) as { total: number | bigint };
  return BigInt(row.total);
}
