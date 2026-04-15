import { db } from "../sqlite.js";

export interface UserRow {
  id: string;
  tg_id: number;
  username: string | null;
  first_name: string;
  photo_url: string | null;
  memo: string;
  is_house: number;
  created_at: number;
  last_seen_at: number;
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
