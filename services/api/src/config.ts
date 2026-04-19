import "dotenv/config";
import { z } from "zod";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  BOT_TOKEN: z.string().min(1, "BOT_TOKEN required (get from BotFather)"),
  BOT_USERNAME: z.string().optional().default(""),
  PUBLIC_WEB_URL: z.string().url().optional().default("http://localhost:5173"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET should be at least 16 chars"),

  DB_PATH: z.string().default("./data/casino.db"),

  TON_NETWORK: z.enum(["mainnet", "testnet"]).default("testnet"),
  TON_ENDPOINT: z.string().url().default("https://testnet.toncenter.com/api/v2/jsonRPC"),
  TON_API_KEY: z.string().optional().default(""),
  HOT_WALLET_MNEMONIC: z.string().optional().default(""),

  RAKE_BPS: z.coerce.number().default(50),
  COUNTDOWN_SECONDS: z.coerce.number().default(30),
  MIN_BET_TON: z.coerce.number().default(0.1),
  MAX_BET_TON: z.coerce.number().default(100),
  MAX_DAILY_WITHDRAW_TON: z.coerce.number().default(500),
  WITHDRAW_COOLDOWN_SECONDS: z.coerce.number().default(60),

  // Singleplayer / house games
  MAX_WIN_TON: z.coerce.number().default(25),          // absolute max profit per bet
  MAX_DAILY_WIN_TON: z.coerce.number().default(500),   // per-user daily net-win cap
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;

export const TON_DECIMALS = 9;
export const NANO_PER_TON = 1_000_000_000n;

export function tonToNano(ton: number): bigint {
  // safe-ish: use string to avoid float precision drift on large numbers
  const [whole, frac = ""] = ton.toString().split(".");
  const fracPadded = (frac + "0".repeat(TON_DECIMALS)).slice(0, TON_DECIMALS);
  return BigInt(whole!) * NANO_PER_TON + BigInt(fracPadded || "0");
}

export function nanoToTon(nano: bigint): string {
  const whole = nano / NANO_PER_TON;
  const frac = nano % NANO_PER_TON;
  return `${whole}.${frac.toString().padStart(TON_DECIMALS, "0")}`;
}
