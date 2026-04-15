// Generate a fresh TON hot wallet. Run once, copy mnemonic into .env, fund testnet from
// the faucet at https://t.me/testgiver_ton_bot.
//
// Usage:  pnpm exec tsx infra/scripts/gen-hot-wallet.ts

import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV4 } from "@ton/ton";

async function main() {
  const words = await mnemonicNew(24);
  const kp = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: kp.publicKey });
  const mainnet = wallet.address.toString({ urlSafe: true, bounceable: false, testOnly: false });
  const testnet = wallet.address.toString({ urlSafe: true, bounceable: false, testOnly: true });
  console.log("\n--- HOT WALLET (KEEP SECRET) ---\n");
  console.log("Mnemonic (paste into .env as HOT_WALLET_MNEMONIC):");
  console.log(`"${words.join(" ")}"`);
  console.log("\nMainnet address:", mainnet);
  console.log("Testnet address:", testnet);
  console.log("\nFund testnet via @testgiver_ton_bot.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
