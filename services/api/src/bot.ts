import { Bot, InlineKeyboard } from "grammy";
import { config } from "./config.js";

let started = false;

export function startBot() {
  if (started) return;
  if (!config.BOT_TOKEN) {
    console.warn("[bot] BOT_TOKEN missing — skipping");
    return;
  }
  const bot = new Bot(config.BOT_TOKEN);

  bot.command("start", async (ctx) => {
    const kb = new InlineKeyboard().webApp("🎰 Open Casino", config.PUBLIC_WEB_URL);
    await ctx.reply(
      "Welcome to Conetic Casino. Stake TON, win the pot, may the wedges be ever in your favor.",
      { reply_markup: kb },
    );
  });

  bot.command("play", async (ctx) => {
    const kb = new InlineKeyboard().webApp("🎰 Open Casino", config.PUBLIC_WEB_URL);
    await ctx.reply("Tap to open the arena.", { reply_markup: kb });
  });

  bot.catch((err) => console.error("[bot] error", err));

  if (config.PUBLIC_WEB_URL.startsWith("https://")) {
    bot.api
      .setChatMenuButton({
        menu_button: { type: "web_app", text: "Play", web_app: { url: config.PUBLIC_WEB_URL } },
      })
      .catch((err) => console.warn("[bot] setChatMenuButton failed:", err.message));
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
