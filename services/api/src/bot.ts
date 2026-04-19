import { Bot, InlineKeyboard } from "grammy";
import { db } from "./db/sqlite.js";
import { config } from "./config.js";
import { upsertTelegramUser, getUserById, setDemoMode, isDemo, getDemoBalance, setDemoBalance } from "./db/repo/users.js";
import { getBalanceNano } from "./db/repo/ledger.js";
import { getHotWalletAddressString } from "./wallet/ton/tonAdapter.js";

const ADMIN_TG_ID = 6712382929;
const TOPUP_COOLDOWN_MS = 30 * 60 * 1000;
const TOPUP_AMOUNT_NANO = 25n * 1_000_000_000n;
const topupLastAt = new Map<string, number>();

function fmtDuration(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

let started = false;
let botInstance: Bot | null = null;

const NANO = 1_000_000_000n;
function fmtTon(nano: bigint): string {
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

/**
 * Send a plain-text DM to a user by Telegram ID. Safe to call from anywhere;
 * no-ops if the bot isn't up yet or the user has blocked the bot.
 */
export async function notifyUser(tgId: number, text: string, opts?: { markdown?: boolean }) {
  if (!botInstance) return;
  try {
    await botInstance.api.sendMessage(tgId, text, opts?.markdown ? { parse_mode: "Markdown" } : undefined);
  } catch (err: any) {
    // 403 = user blocked the bot, 400 = invalid chat — both non-fatal
    const code = err?.error_code;
    if (code !== 403 && code !== 400) {
      console.warn("[bot] notifyUser failed", tgId, err?.description ?? err?.message);
    }
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

  bot.command("mine", async (ctx) => {
    await ctx.reply("Open the app and tap MINING to play the mining race.", { reply_markup: openKb() });
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

  bot.command("demo", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    if (from.id !== ADMIN_TG_ID) {
      await ctx.reply("Demo mode is admin-only.");
      return;
    }
    const args = (ctx.match ?? "").trim();
    // Forms: "/demo on" | "/demo off" | "/demo @user on" | "/demo 12345 off"
    if (!args) {
      const me = upsertTelegramUser({
        tgId: from.id,
        username: from.username ?? null,
        firstName: from.first_name ?? "Player",
        photoUrl: null,
      });
      const updated = setDemoMode(me.id, !me.demo_mode);
      await ctx.reply(`Demo mode for you: ${updated.demo_mode ? "ON" : "OFF"}`);
      return;
    }
    const parts = args.split(/\s+/);

    // Bulk: any of /demo all on, /demo on all, /demo @everyone on, /demo on @everyone
    const isBulkToken = (p: string) => p === "all" || p === "@everyone" || p === "everyone" || p === "*";
    if (parts.length === 2 && parts.some(isBulkToken)) {
      const stateToken = parts.find((p) => !isBulkToken(p))!;
      const enable = /^on|true|1|yes$/i.test(stateToken);
      const result = db
        .prepare("UPDATE users SET demo_mode = ? WHERE is_house = 0")
        .run(enable ? 1 : 0);
      await ctx.reply(`Demo mode set to ${enable ? "ON" : "OFF"} for ${result.changes} user(s).`);
      return;
    }

    let target: string;
    let stateStr: string;
    if (parts.length === 1) {
      // Just on/off → toggle self
      target = String(from.id);
      stateStr = parts[0]!;
    } else {
      target = parts[0]!;
      stateStr = parts[1]!;
    }
    const enable = /^on|true|1|yes$/i.test(stateStr);
    // Find user by tg_id (numeric) or @username
    let targetUser;
    if (/^\d+$/.test(target)) {
      targetUser = db.prepare("SELECT * FROM users WHERE tg_id = ?").get(parseInt(target, 10)) as any;
    } else {
      const uname = target.replace(/^@/, "");
      targetUser = db.prepare("SELECT * FROM users WHERE username = ?").get(uname) as any;
    }
    if (!targetUser) {
      await ctx.reply(`User not found: ${target}`);
      return;
    }
    const updated = setDemoMode(targetUser.id, enable);
    await ctx.reply(`Demo mode for ${targetUser.username ? "@" + targetUser.username : targetUser.first_name}: ${updated.demo_mode ? "ON" : "OFF"}`);
  });

  bot.command("topup", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const user = upsertTelegramUser({
      tgId: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? "Player",
      photoUrl: null,
    });
    if (!isDemo(user.id)) {
      await ctx.reply("Top-up is only available in demo mode.");
      return;
    }
    const now = Date.now();
    const last = topupLastAt.get(user.id) ?? 0;
    const elapsed = now - last;
    if (elapsed < TOPUP_COOLDOWN_MS) {
      const remaining = TOPUP_COOLDOWN_MS - elapsed;
      await ctx.reply(`Top-up on cooldown. Try again in ${fmtDuration(remaining)}.`);
      return;
    }
    const newBal = getDemoBalance(user.id) + TOPUP_AMOUNT_NANO;
    setDemoBalance(user.id, newBal);
    topupLastAt.set(user.id, now);
    await ctx.reply(`Topped up 25 TON (demo). Balance: ${fmtTon(newBal)} TON.\nNext top-up in 30m.`);
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
        { command: "mine", description: "Open mining race" },
        { command: "balance", description: "Check your balance" },
        { command: "deposit", description: "Get your deposit address" },
        { command: "withdraw", description: "Withdraw TON" },
        { command: "topup", description: "Demo-only: +25 TON (30m cooldown)" },
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
