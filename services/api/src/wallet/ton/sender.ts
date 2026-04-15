import { config } from "../../config.js";
import { markWithdrawalFailed, markWithdrawalSent, pendingWithdrawals } from "../../db/repo/wallet.js";
import { getAdapter } from "../registry.js";

let running = false;
let timer: NodeJS.Timeout | null = null;
const TICK_MS = 5000;

export function startTonSender() {
  if (running || !config.HOT_WALLET_MNEMONIC) return;
  running = true;
  const tick = async () => {
    try {
      await processOnce();
    } catch (err) {
      console.error("[ton-sender] tick failed", err);
    } finally {
      timer = setTimeout(tick, TICK_MS);
    }
  };
  tick();
}

export function stopTonSender() {
  running = false;
  if (timer) clearTimeout(timer);
}

async function processOnce() {
  const adapter = getAdapter("ton");
  for (const w of pendingWithdrawals()) {
    try {
      const { txHash } = await adapter.sendWithdrawal({
        to: w.to_address,
        amountNano: BigInt(w.amount_nano),
        idempotencyKey: w.idempotency_key,
      });
      markWithdrawalSent(w.id, txHash);
      console.log(`[ton-sender] sent ${w.amount_nano} to ${w.to_address} tx=${txHash}`);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      markWithdrawalFailed(w.id, msg);
      console.error(`[ton-sender] failed ${w.id}:`, msg);
    }
  }
}
