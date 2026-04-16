-- Mining Race game: separate game state from the arena, but share users + ledger.

CREATE TABLE IF NOT EXISTS mining_rounds (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  status               TEXT NOT NULL,           -- 'WAITING'|'COUNTDOWN'|'LIVE'|'RESOLVED'|'REFUNDED'
  server_seed_hex      TEXT NOT NULL,
  server_seed_hash     TEXT NOT NULL,
  trajectory_seed_hex  TEXT,
  pot_nano             TEXT NOT NULL DEFAULT '0',
  winner_user_id       TEXT REFERENCES users(id),
  winner_payout_nano   TEXT,
  rake_nano            TEXT,
  started_at           INTEGER NOT NULL,
  countdown_ends_at    INTEGER,
  resolved_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mining_rounds_status ON mining_rounds(status);

CREATE TABLE IF NOT EXISTS mining_bets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id        INTEGER NOT NULL REFERENCES mining_rounds(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  amount_nano     TEXT NOT NULL,
  client_seed_hex TEXT NOT NULL,
  final_gems      INTEGER,
  created_at      INTEGER NOT NULL,
  UNIQUE(round_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mining_bets_round ON mining_bets(round_id);
