import { Address } from "@ton/core";
import { config } from "../../config.js";
import type { ChainAdapter, IncomingDeposit } from "../chain.js";
import { getHotWallet, sendTon } from "./hotWallet.js";

export class TonAdapter implements ChainAdapter {
  readonly chainId = "ton" as const;
  readonly decimals = 9;
  readonly network = config.TON_NETWORK;

  getDepositTarget(_userId: string, memo: string) {
    // address resolved lazily by caller via getHotWalletAddress(); returning placeholder here
    return { address: "<<HOT_WALLET>>", memo };
  }

  async parseIncoming(cursor: string | null): Promise<{ nextCursor: string; credits: IncomingDeposit[] }> {
    const hw = await getHotWallet();
    const limit = 25;
    const opts: { limit: number; lt?: string; hash?: string } = { limit };
    if (cursor) {
      const [lt, hash] = cursor.split(":");
      if (lt && hash) {
        opts.lt = lt;
        opts.hash = hash;
      }
    }

    const txs = await hw.client.getTransactions(hw.address, opts);
    const credits: IncomingDeposit[] = [];
    let newest: { lt: string; hash: string } | null = null;

    for (const tx of txs) {
      const ltStr = tx.lt.toString();
      const hashStr = Buffer.from(tx.hash()).toString("hex");
      if (!newest) newest = { lt: ltStr, hash: hashStr };

      const inMsg = tx.inMessage;
      if (!inMsg || inMsg.info.type !== "internal") continue;
      const value = inMsg.info.value.coins;
      if (value <= 0n) continue;

      // Extract comment from message body if it follows the standard text-comment opcode.
      let memo: string | null = null;
      try {
        const slice = inMsg.body.beginParse();
        if (slice.remainingBits >= 32) {
          const op = slice.loadUint(32);
          if (op === 0) {
            memo = slice.loadStringTail();
          }
        }
      } catch {
        memo = null;
      }

      credits.push({
        txHash: hashStr,
        lt: ltStr,
        amountNano: value,
        memo,
        fromAddress: inMsg.info.src?.toString({ urlSafe: true, bounceable: false }) ?? null,
      });
    }

    const nextCursor = newest ? `${newest.lt}:${newest.hash}` : (cursor ?? "");
    return { nextCursor, credits };
  }

  async sendWithdrawal(input: { to: string; amountNano: bigint; idempotencyKey: string }) {
    const to = Address.parse(input.to);
    const { seqno } = await sendTon({ to, amountNano: input.amountNano, comment: `cc-w:${input.idempotencyKey}` });
    return { txHash: `seqno:${seqno}` }; // real hash arrives async — caller can fetch later
  }

  validateAddress(addr: string): boolean {
    try {
      Address.parse(addr);
      return true;
    } catch {
      return false;
    }
  }

  async estimateFeeNano(_amountNano: bigint): Promise<bigint> {
    // Conservative estimate: 0.01 TON per outbound transfer.
    return 10_000_000n;
  }
}

export async function getHotWalletAddressString(): Promise<string> {
  const hw = await getHotWallet();
  return hw.address.toString({ urlSafe: true, bounceable: false, testOnly: config.TON_NETWORK === "testnet" });
}
