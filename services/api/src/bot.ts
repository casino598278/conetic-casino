import { Bot, InlineKeyboard } from "grammy";
import { config } from "./config.js";
import { upsertTelegramUser } from "./db/repo/users.js";
import { credit, getBalanceNano } from "./db/repo/ledger.js";
import { pushBalance } from "./ws/gateway.js";

let started = false;

const NANO = 1_000_000_000n;
const PLAY_MONEY_AMOUNT_NANO = 1000n * NANO; // 1000 TON of play balance per /deposit
const PLAY_MONEY_DAILY_CAP_NANO = 5000n * NANO;

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

  bot.command("start", async (ctx) => {
    const kb = new InlineKeyboard().webApp("Open Casino", config.PUBLIC_WEB_URL);
    await ctx.reply(
      "Welcome to Conetic Casino.\n\n" +
        "Commands:\n" +
        "/play - open the arena\n" +
        "/deposit - credit 1000 TON test balance (testnet)\n" +
        "/balance - check your balance",
      { reply_markup: kb },
    );
  });

  bot.command("play", async (ctx) => {
    const kb = new InlineKeyboard().webApp("Open Casino", config.PUBLIC_WEB_URL);
    await ctx.reply("Tap to open the arena.", { reply_markup: kb });
  });

  bot.command("balance", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;
    const user = upsertTelegramUser({
      tgId: tgUser.id,
      username: tgUser.username ?? null,
      firstName: tgUser.first_name ?? "Player",
      photoUrl: null,
    });
    const bal = getBalanceNano(user.id);
    await ctx.reply(`Your balance: ${fmtTon(bal)} TON`);
  });

  bot.command("deposit", async (ctx) => {
    if (config.TON_NETWORK !== "testnet") {
      await ctx.reply("/deposit is only available on testnet — use the Wallet sheet in the app to deposit real TON.");
      return;
    }
    const tgUser = ctx.from;
    if (!tgUser) return;
    const user = upsertTelegramUser({
      tgId: tgUser.id,
      username: tgUser.username ?? null,
      firstName: tgUser.first_name ?? "Player",
      photoUrl: null,
    });
    const currentBal = getBalanceNano(user.id);
    if (currentBal >= PLAY_MONEY_DAILY_CAP_NANO) {
      await ctx.reply(
        `You already have ${fmtTon(currentBal)} TON of test balance. ` +
          `Cap is ${fmtTon(PLAY_MONEY_DAILY_CAP_NANO)} TON — go play /play before topping up more.`,
      );
      return;
    }
    credit({
      userId: user.id,
      amountNano: PLAY_MONEY_AMOUNT_NANO,
      reason: "bonus",
      refId: `play-money:${Date.now()}`,
    });
    const newBal = getBalanceNano(user.id);
    pushBalance(user.id, newBal);
    await ctx.reply(
      `Credited ${fmtTon(PLAY_MONEY_AMOUNT_NANO)} TON test balance.\n` +
        `New balance: ${fmtTon(newBal)} TON\n\n` +
        `Tap /play to start staking.`,
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
        { command: "start", description: "Welcome + open the casino" },
        { command: "play", description: "Open the arena" },
        { command: "deposit", description: "Get 1000 TON test balance (testnet)" },
        { command: "balance", description: "Check your balance" },
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
