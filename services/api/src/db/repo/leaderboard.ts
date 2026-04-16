import { db } from "../sqlite.js";
import { getUserById, getPublicIdentity } from "./users.js";

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function addWager(userId: string, amountNano: bigint) {
  const ym = currentYearMonth();
  db.prepare(
    `INSERT INTO monthly_wagers (user_id, year_month, total_nano)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, year_month)
     DO UPDATE SET total_nano = CAST(CAST(total_nano AS INTEGER) + CAST(excluded.total_nano AS INTEGER) AS TEXT)`,
  ).run(userId, ym, amountNano.toString());
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string | null;
  firstName: string;
  photoUrl: string | null;
  totalWageredNano: string;
}

export function getLeaderboard(limit = 20): LeaderboardEntry[] {
  const ym = currentYearMonth();
  const rows = db
    .prepare(
      `SELECT user_id, total_nano FROM monthly_wagers
       WHERE year_month = ?
       ORDER BY CAST(total_nano AS INTEGER) DESC
       LIMIT ?`,
    )
    .all(ym, limit) as { user_id: string; total_nano: string }[];

  return rows.map((r, i) => {
    const user = getUserById(r.user_id);
    const pub = user ? getPublicIdentity(user) : { username: null, firstName: "?", photoUrl: null };
    return {
      rank: i + 1,
      userId: r.user_id,
      username: pub.username,
      firstName: pub.firstName,
      photoUrl: pub.photoUrl,
      totalWageredNano: r.total_nano,
    };
  });
}

/** Seconds until the 1st of next month (leaderboard reset). */
export function secondsUntilReset(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
}
