import { config } from "../../config.js";
import { txn } from "../../db/sqlite.js";
import { credit } from "../../db/repo/ledger.js";
import { depositExists, getCursor, insertDeposit, setCursor } from "../../db/repo/wallet.js";
import { getUserByMemo } from "../../db/repo/users.js";
import { getAdapter } from "../registry.js";

let running = false;
let timer: NodeJS.Timeout | null = null;
const POLL_MS = 6000;

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
    console.log(`[ton-watcher] credited ${c.amountNano} nano to ${user.id} (memo=${c.memo})`);
  }

  if (nextCursor) setCursor("ton", nextCursor);
}
