import { Bot, InlineKeyboard } from "grammy";
import { config } from "./config.js";
import { upsertTelegramUser, getUserById } from "./db/repo/users.js";
import { getHotWalletAddressString } from "./wallet/ton/tonAdapter.js";
import { credit, getBalanceNano } from "./db/repo/ledger.js";
import { pushBalance } from "./ws/gateway.js";
import { ADMIN_TG_ID } from "./admin/constants.js";

const NANO = 1_000_000_000n;
const TOPUP_DEFAULT_TON = 10_000;

function tonToNano(ton: number): bigint {
  const s = ton.toFixed(9);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * NANO + BigInt(frac.padEnd(9, "0").slice(0, 9));
}
function fmtTon(nano: bigint): string {
  const whole = nano / NANO;
  const frac = (nano % NANO).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

let started = false;
let botInstance: Bot | null = null;

/**
 * Formerly sent a DM to a user. All unsolicited bot DMs have been disabled
 * per product direction — now just logs to server console so the call sites
 * (deposit watcher, withdraw sender, round-end hooks) still work without
 * spamming players. Re-enable by restoring the sendMessage body below.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function notifyUser(tgId: number, text: string, _opts?: { markdown?: boolean }) {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[bot] would-notify tg:${tgId} ${text.slice(0, 120)}`);
  }
}

export function startBot() {
  if (started) return;
  if (!config.BOT_TOKEN) {
    console.warn("[bot] BOT_TOKEN missing — skipping");
    return;
  }
  const bot = new Bot(config.BOT_TOKEN);
  botInstance = bot;

  const openKb = () =>
    new InlineKeyboard().webApp("Open Casino", config.PUBLIC_WEB_URL);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Welcome to Conetic Casino.\n\n" +
        "Commands:\n" +
        "/deposit — get your deposit address\n" +
        "/withdraw — withdraw TON",
      { reply_markup: openKb() },
    );
  });

  bot.command("deposit", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const user = upsertTelegramUser({
      tgId: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? "Player",
      photoUrl: null,
    });
    const fresh = getUserById(user.id);
    if (!fresh) return;

    let address: string;
    try {
      address = await getHotWalletAddressString();
    } catch {
      await ctx.reply("Deposits are temporarily unavailable. Try again later.");
      return;
    }

    const network = config.TON_NETWORK === "testnet" ? " (testnet)" : "";
    await ctx.reply(
      `Send TON${network} to:\n` +
        `\`${address}\`\n\n` +
        `You MUST include this memo or your deposit won't be credited:\n` +
        `\`${fresh.memo}\`\n\n` +
        `Deposits credit automatically within ~10 seconds.`,
      { parse_mode: "Markdown", reply_markup: openKb() },
    );
  });

  bot.command("withdraw", async (ctx) => {
    await ctx.reply(
      "Open the Wallet tab in the app to withdraw.",
      { reply_markup: openKb() },
    );
  });

  // Admin-only: credit TON to the admin's balance. Useful for testing flows
  // without needing to spin up a Render shell session. Usage:
  //   /topup          → credits TOPUP_DEFAULT_TON
  //   /topup 500      → credits 500 TON
  bot.command("topup", async (ctx) => {
    const from = ctx.from;
    if (!from || from.id !== ADMIN_TG_ID) {
      await ctx.reply("Admin only.");
      return;
    }
    const arg = (ctx.match ?? "").trim();
    const ton = arg === "" ? TOPUP_DEFAULT_TON : Number(arg);
    if (!Number.isFinite(ton) || ton <= 0) {
      await ctx.reply("Usage: /topup [amount_ton]\nExample: /topup 500");
      return;
    }
    const user = upsertTelegramUser({
      tgId: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? "Admin",
      photoUrl: null,
    });
    const amountNano = tonToNano(ton);
    credit({
      userId: user.id,
      amountNano,
      reason: "bonus",
      refId: `topup-${Date.now()}`,
    });
    const newBal = getBalanceNano(user.id);
    pushBalance(user.id, newBal);
    await ctx.reply(
      `Credited ${ton.toLocaleString()} TON.\nBalance: ${fmtTon(newBal)} TON.`,
      { reply_markup: openKb() },
    );
  });

  bot.catch((err) => console.error("[bot] error", err));

  if (config.PUBLIC_WEB_URL.startsWith("https://")) {
    bot.api
      .setChatMenuButton({
        menu_button: { type: "web_app", text: "Play", web_app: { url: config.PUBLIC_WEB_URL } },
      })
      .catch((err) => console.warn("[bot] setChatMenuButton failed:", err.message));

    bot.api
      .setMyCommands([
        { command: "start", description: "Welcome + menu" },
        { command: "deposit", description: "Get your deposit address" },
        { command: "withdraw", description: "Withdraw TON" },
        { command: "topup", description: "(admin) credit TON to balance" },
      ])
      .catch((err) => console.warn("[bot] setMyCommands failed:", err.message));
  } else {
    console.warn(`[bot] PUBLIC_WEB_URL not HTTPS (${config.PUBLIC_WEB_URL}) — skipping menu button`);
  }

  bot
    .start({
      onStart: (me) => console.log(`[bot] @${me.username} polling`),
    })
    .catch((err) => console.error("[bot] start failed:", err));

  started = true;
}

// botInstance is retained for the disabled notifyUser hook, not directly used.
void botInstance;
