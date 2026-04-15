import { createHmac } from "node:crypto";

export interface VerifiedTelegramUser {
  tgId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  authDate: number;
}

const MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Verify Telegram WebApp initData per spec:
 *   secret = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)
 *   data_check_string = sorted "key=value" lines (excluding hash) joined by \n
 *   expected_hash = HMAC_SHA256(key=secret, msg=data_check_string).hex()
 *   compare with `hash` field.
 *
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  opts: { allowExpired?: boolean } = {},
): VerifiedTelegramUser {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new AuthError("missing hash");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => [k, v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (!constantTimeEqual(expected, hash)) throw new AuthError("invalid hash");

  const authDateStr = params.get("auth_date");
  if (!authDateStr) throw new AuthError("missing auth_date");
  const authDate = parseInt(authDateStr, 10);
  if (!Number.isFinite(authDate)) throw new AuthError("bad auth_date");
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (!opts.allowExpired && ageSec > MAX_AGE_SECONDS) throw new AuthError("initData expired");

  const userJson = params.get("user");
  if (!userJson) throw new AuthError("missing user");
  let parsed: any;
  try {
    parsed = JSON.parse(userJson);
  } catch {
    throw new AuthError("bad user json");
  }

  if (typeof parsed.id !== "number") throw new AuthError("bad user.id");
  return {
    tgId: parsed.id,
    username: parsed.username ?? null,
    firstName: typeof parsed.first_name === "string" ? parsed.first_name : "Player",
    lastName: parsed.last_name ?? null,
    photoUrl: parsed.photo_url ?? null,
    authDate,
  };
}

export class AuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AuthError";
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
