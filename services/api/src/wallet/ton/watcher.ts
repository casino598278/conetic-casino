import { config } from "../../config.js";
import { txn } from "../../db/sqlite.js";
import { credit, getBalanceNano } from "../../db/repo/ledger.js";
import { depositExists, getCursor, insertDeposit, setCursor } from "../../db/repo/wallet.js";
import { getUserByMemo } from "../../db/repo/users.js";
import { getAdapter } from "../registry.js";
import { pushBalance } from "../../ws/gateway.js";
import { notifyUser } from "../../bot.js";

let running = false;
let timer: NodeJS.Timeout | null = null;
const POLL_MS = 6000;

const NANO = 1_000_000_000n;
function fmtTonAmount(nano: bigint): string {
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

export function startTonWatcher() {
  if (running || !config.HOT_WALLET_MNEMONIC) {
    if (!config.HOT_WALLET_MNEMONIC) {
      console.warn("[ton-watcher] HOT_WALLET_MNEMONIC missing, skipping watcher");
    }
    return;
  }
  running = true;
  const tick = async () => {
    try {
      await pollOnce();
    } catch (err) {
      console.error("[ton-watcher] poll failed", err);
    } finally {
      timer = setTimeout(tick, POLL_MS);
    }
  };
  tick();
}

export function stopTonWatcher() {
  running = false;
  if (timer) clearTimeout(timer);
}

async function pollOnce() {
  const adapter = getAdapter("ton");
  const cursor = getCursor("ton");
  const { nextCursor, credits } = await adapter.parseIncoming(cursor);

  for (const c of credits) {
    if (depositExists("ton", c.txHash, c.lt)) continue;
    if (!c.memo) continue;
    const user = getUserByMemo(c.memo);
    if (!user) {
      console.warn("[ton-watcher] unknown memo", c.memo, "tx", c.txHash);
      continue;
    }
    txn(() => {
      insertDeposit({
        chainId: "ton",
        userId: user.id,
        txHash: c.txHash,
        lt: c.lt,
        amountNano: c.amountNano,
        memo: c.memo,
        fromAddress: c.fromAddress,
      });
      credit({
        userId: user.id,
        amountNano: c.amountNano,
        reason: "deposit",
        refId: `${c.txHash}:${c.lt}`,
      });
    });
    // Push fresh balance to the user's connected sockets so their UI updates live.
    const newBal = getBalanceNano(user.id);
    try {
      pushBalance(user.id, newBal);
    } catch (err) {
      console.warn("[ton-watcher] pushBalance failed", err);
    }
    console.log(`[ton-watcher] credited ${c.amountNano} nano to ${user.id} (memo=${c.memo})`);

    // DM the user
    const amountTon = fmtTonAmount(c.amountNano);
    const balTon = fmtTonAmount(newBal);
    notifyUser(
      user.tg_id,
      `Deposit received: +${amountTon} TON\nBalance: ${balTon} TON`,
    ).catch(() => {});
  }

  if (nextCursor) setCursor("ton", nextCursor);
}
