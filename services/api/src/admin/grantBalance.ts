// One-off admin script: credit a user's balance by tg_id.
//
// Usage (from the services/api dir on the server, AFTER the service has been
// built at least once so the migrations + schema are in place):
//
//   node --loader ts-node/esm src/admin/grantBalance.ts <tgId> <tonAmount>
//
// Or, with the compiled build:
//
//   node dist/admin/grantBalance.js <tgId> <tonAmount>
//
// Example on Render Shell:
//   cd services/api && node dist/admin/grantBalance.js 6712382929 10000
//
// The credit lands as a "bonus" ledger entry and the user's WS gets a
// balance:update so the open mini-app refreshes in-place.

import { runMigrations } from "../db/sqlite.js";
import { upsertTelegramUser } from "../db/repo/users.js";
import { credit, getBalanceNano } from "../db/repo/ledger.js";

const NANO = 1_000_000_000n;

function tonToNano(ton: number): bigint {
  const s = ton.toFixed(9);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * NANO + BigInt(frac.padEnd(9, "0").slice(0, 9));
}

async function main() {
  const [tgIdStr, amountStr] = process.argv.slice(2);
  if (!tgIdStr || !amountStr) {
    console.error("Usage: node dist/admin/grantBalance.js <tgId> <tonAmount>");
    process.exit(2);
  }
  const tgId = Number(tgIdStr);
  const ton = Number(amountStr);
  if (!Number.isInteger(tgId) || tgId <= 0) {
    console.error(`bad tgId: ${tgIdStr}`);
    process.exit(2);
  }
  if (!Number.isFinite(ton) || ton <= 0) {
    console.error(`bad amount: ${amountStr}`);
    process.exit(2);
  }

  runMigrations();

  const user = upsertTelegramUser({
    tgId,
    username: null,
    firstName: `tg_${tgId}`,
    photoUrl: null,
  });
  const amountNano = tonToNano(ton);
  const before = getBalanceNano(user.id);
  credit({
    userId: user.id,
    amountNano,
    reason: "bonus",
    refId: `admin-grant-${Date.now()}`,
  });
  const after = getBalanceNano(user.id);
  console.log(
    `credited ${ton} TON to user ${user.id} (tg ${tgId}): ${before} → ${after} nano`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
