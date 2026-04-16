import { Bot, InlineKeyboard } from "grammy";
import { config } from "./config.js";
import { upsertTelegramUser, getUserById } from "./db/repo/users.js";
import { getBalanceNano } from "./db/repo/ledger.js";
import { getHotWalletAddressString } from "./wallet/ton/tonAdapter.js";

let started = false;

const NANO = 1_000_000_000n;
function fmtTon(nano: bigint): string {
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

export function startBot() {
  if (started) return;
  if (!config.BOT_TOKEN) {
    console.warn("[bot] BOT_TOKEN missing — skipping");
    return;
  }
  const bot = new Bot(config.BOT_TOKEN);

  const openKb = () =>
    new InlineKeyboard().webApp("Open Casino", config.PUBLIC_WEB_URL);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Welcome to Conetic Casino.\n\n" +
        "Stake TON, win the pot. 0.5% rake, provably fair.\n\n" +
        "Commands:\n" +
        "/play — open the arena\n" +
        "/balance — check your balance\n" +
        "/deposit — get your deposit address\n" +
        "/withdraw — withdraw TON",
      { reply_markup: openKb() },
    );
  });

  bot.command("play", async (ctx) => {
    await ctx.reply("Tap to open the arena.", { reply_markup: openKb() });
  });

  bot.command("balance", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const user = upsertTelegramUser({
      tgId: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? "Player",
      photoUrl: null,
    });
    const bal = getBalanceNano(user.id);
    await ctx.reply(`Your balance: ${fmtTon(bal)} TON`);
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

  bot.catch((err) => console.error("[bot] error", err));

  if (config.PUBLIC_WEB_URL.startsWith("https://")) {
    bot.api
      .setChatMenuButton({
        menu_button: { type: "web_app", text: "Play", web_app: { url: config.PUBLIC_WEB_URL } },
      })
      .catch((err) => console.warn("[bot] setChatMenuButton failed:", err.message));

    bot.api
      .setMyCommands([
        { command: "play", description: "Open the arena" },
        { command: "balance", description: "Check your balance" },
        { command: "deposit", description: "Get your deposit address" },
        { command: "withdraw", description: "Withdraw TON" },
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
