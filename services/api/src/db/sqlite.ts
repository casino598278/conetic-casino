import Database, { type Database as DatabaseType } from "better-sqlite3";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

mkdirSync(dirname(resolve(config.DB_PATH)), { recursive: true });
export const db: DatabaseType = new Database(config.DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");
// Auto-checkpoint every 1000 pages (~4MB) so the -wal file doesn't grow unbounded.
db.pragma("wal_autocheckpoint = 1000");

export function runMigrations() {
  const dir = join(__dirname, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );`);
  const applied = new Set(
    db.prepare("SELECT name FROM _migrations").all().map((r: any) => r.name as string),
  );
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), "utf-8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(f, Date.now());
    })();
    console.log(`[db] applied migration ${f}`);
  }
}

/** Run a function inside an IMMEDIATE transaction (write-lock from start). */
export function txn<T>(fn: () => T): T {
  return db.transaction(fn).immediate();
}
