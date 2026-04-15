import { mnemonicToPrivateKey } from "@ton/crypto";
import { TonClient, WalletContractV4, internal } from "@ton/ton";
import { Address } from "@ton/core";
import { config } from "../../config.js";

let cached: HotWallet | null = null;

export interface HotWallet {
  client: TonClient;
  wallet: WalletContractV4;
  address: Address;
  publicKey: Buffer;
  secretKey: Buffer;
}

export async function getHotWallet(): Promise<HotWallet> {
  if (cached) return cached;
  if (!config.HOT_WALLET_MNEMONIC) {
    throw new Error("HOT_WALLET_MNEMONIC not set — run `pnpm exec tsx infra/scripts/gen-hot-wallet.ts`");
  }
  const words = config.HOT_WALLET_MNEMONIC.trim().split(/\s+/);
  const keyPair = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
  const client = new TonClient({
    endpoint: config.TON_ENDPOINT,
    apiKey: config.TON_API_KEY || undefined,
  });
  cached = {
    client,
    wallet,
    address: wallet.address,
    publicKey: keyPair.publicKey,
    secretKey: keyPair.secretKey,
  };
  return cached;
}

export async function sendTon(input: {
  to: Address;
  amountNano: bigint;
  comment?: string;
}): Promise<{ seqno: number }> {
  const hw = await getHotWallet();
  const opened = hw.client.open(hw.wallet);
  const seqno = await opened.getSeqno();
  await opened.sendTransfer({
    seqno,
    secretKey: hw.secretKey,
    messages: [
      internal({
        to: input.to,
        value: input.amountNano,
        body: input.comment,
        bounce: false,
      }),
    ],
  });
  return { seqno };
}

export { internal, Address };
