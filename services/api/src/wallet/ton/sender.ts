import { config } from "../../config.js";
import { markWithdrawalFailed, markWithdrawalSent, pendingWithdrawals } from "../../db/repo/wallet.js";
import { getUserById } from "../../db/repo/users.js";
import { getAdapter } from "../registry.js";
import { notifyUser } from "../../bot.js";

let running = false;
let timer: NodeJS.Timeout | null = null;
const TICK_MS = 5000;

const NANO = 1_000_000_000n;
function fmtTonAmount(nano: bigint): string {
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

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

      const user = getUserById(w.user_id);
      if (user) {
        notifyUser(
          user.tg_id,
          `Withdrawal sent: ${fmtTonAmount(BigInt(w.amount_nano))} TON → ${short(w.to_address)}`,
        ).catch(() => {});
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      markWithdrawalFailed(w.id, msg);
      console.error(`[ton-sender] failed ${w.id}:`, msg);

      const user = getUserById(w.user_id);
      if (user) {
        notifyUser(
          user.tg_id,
          `Withdrawal failed: ${fmtTonAmount(BigInt(w.amount_nano))} TON. Funds remain in your balance.`,
        ).catch(() => {});
      }
    }
  }
}

function short(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 5)}…${addr.slice(-5)}`;
}
