import { db } from "../sqlite.js";

export interface UserRow {
  id: string;
  tg_id: number;
  username: string | null;
  first_name: string;
  photo_url: string | null;
  memo: string;
  is_house: number;
  anon_mode: number;
  anon_name: string | null;
  demo_mode: number;
  demo_balance_nano: string;
  created_at: number;
  last_seen_at: number;
}

export function setDemoMode(userId: string, enabled: boolean): UserRow {
  db.prepare("UPDATE users SET demo_mode = ? WHERE id = ?").run(enabled ? 1 : 0, userId);
  return getUserById(userId)!;
}

export function getDemoBalance(userId: string): bigint {
  const u = getUserById(userId);
  return u ? BigInt(u.demo_balance_nano) : 0n;
}

export function setDemoBalance(userId: string, balanceNano: bigint) {
  db.prepare("UPDATE users SET demo_balance_nano = ? WHERE id = ?").run(balanceNano.toString(), userId);
}

export function isDemo(userId: string): boolean {
  const u = getUserById(userId);
  return !!u?.demo_mode;
}

const ANON_ADJECTIVES = ["Swift","Lucky","Shadow","Wild","Dark","Brave","Gold","Steel","Iron","Neon"];
const ANON_NOUNS = ["Wolf","Fox","Bear","Eagle","Shark","Tiger","Falcon","Cobra","Phoenix","Raven"];

function generateAnonName(): string {
  const adj = ANON_ADJECTIVES[Math.floor(Math.random() * ANON_ADJECTIVES.length)]!;
  const noun = ANON_NOUNS[Math.floor(Math.random() * ANON_NOUNS.length)]!;
  const num = Math.floor(Math.random() * 100);
  return `${adj}${noun}${num}`;
}

export function setAnonMode(userId: string, enabled: boolean): UserRow {
  if (enabled) {
    // Only generate a name if the user doesn't already have one.
    // Once assigned, the anon name is permanent.
    const existing = getUserById(userId);
    if (existing?.anon_name) {
      db.prepare("UPDATE users SET anon_mode = 1 WHERE id = ?").run(userId);
    } else {
      db.prepare("UPDATE users SET anon_mode = 1, anon_name = ? WHERE id = ?").run(
        generateAnonName(),
        userId,
      );
    }
  } else {
    // Turn off anon mode but KEEP the name for next time.
    db.prepare("UPDATE users SET anon_mode = 0 WHERE id = ?").run(userId);
  }
  return getUserById(userId)!;
}

/** Return display name + photo for a user, respecting anon mode. */
export function getPublicIdentity(user: UserRow): {
  username: string | null;
  firstName: string;
  photoUrl: string | null;
} {
  if (user.anon_mode && user.anon_name) {
    return { username: null, firstName: user.anon_name, photoUrl: null };
  }
  return {
    username: user.username,
    firstName: user.first_name,
    photoUrl: user.photo_url,
  };
}

const HOUSE_ID = "house";

export function ensureHouseUser(): UserRow {
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(HOUSE_ID) as UserRow | undefined;
  if (existing) return existing;
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, tg_id, username, first_name, photo_url, memo, is_house, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(HOUSE_ID, 0, "house", "House", null, "house", now, now);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(HOUSE_ID) as UserRow;
}

export function getHouseUserId(): string {
  return HOUSE_ID;
}

export function upsertTelegramUser(input: {
  tgId: number;
  username: string | null;
  firstName: string;
  photoUrl: string | null;
}): UserRow {
  const existing = db.prepare("SELECT * FROM users WHERE tg_id = ?").get(input.tgId) as
    | UserRow
    | undefined;
  const now = Date.now();
  if (existing) {
    db.prepare(
      `UPDATE users SET username = ?, first_name = ?, photo_url = ?, last_seen_at = ? WHERE id = ?`,
    ).run(input.username, input.firstName, input.photoUrl, now, existing.id);
    return db.prepare("SELECT * FROM users WHERE id = ?").get(existing.id) as UserRow;
  }
  const id = `tg_${input.tgId}`;
  const memo = `cc-${input.tgId}`;
  db.prepare(
    `INSERT INTO users (id, tg_id, username, first_name, photo_url, memo, is_house, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, input.tgId, input.username, input.firstName, input.photoUrl, memo, now, now);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
}

export function getUserById(id: string): UserRow | null {
  return (db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined) ?? null;
}

export function getUserByMemo(memo: string): UserRow | null {
  return (db.prepare("SELECT * FROM users WHERE memo = ?").get(memo) as UserRow | undefined) ?? null;
}
