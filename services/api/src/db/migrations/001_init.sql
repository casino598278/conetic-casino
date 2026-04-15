-- Conetic Casino schema v1 (SQLite)

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,           -- ULID or 'tg_<tgId>'
  tg_id         INTEGER UNIQUE NOT NULL,
  username      TEXT,
  first_name    TEXT NOT NULL,
  photo_url     TEXT,
  memo          TEXT UNIQUE NOT NULL,       -- deposit memo: 'cc-<tgId>'
  is_house      INTEGER NOT NULL DEFAULT 0, -- house account = rake collector
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_tg ON users(tg_id);

-- Double-entry ledger. balance(user) = SUM(delta) WHERE user_id = ?
CREATE TABLE IF NOT EXISTS ledger_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  chain_id    TEXT NOT NULL DEFAULT 'ton',
  delta_nano  TEXT NOT NULL,                -- bigint as string (signed)
  reason      TEXT NOT NULL,                -- 'deposit'|'bet'|'win'|'rake'|'refund'|'withdraw'|'withdraw_fee'|'bonus'
  ref_id      TEXT,                         -- deposit_id, withdrawal_id, etc.
  round_id    INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, chain_id);
CREATE INDEX IF NOT EXISTS idx_ledger_round ON ledger_entries(round_id);

CREATE TABLE IF NOT EXISTS deposits (
  id           TEXT PRIMARY KEY,            -- chain_id + ':' + tx_hash + ':' + lt
  chain_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id),
  tx_hash      TEXT NOT NULL,
  lt           TEXT NOT NULL,
  amount_nano  TEXT NOT NULL,
  memo         TEXT,
  from_address TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE(chain_id, tx_hash, lt)
);
CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);

CREATE TABLE IF NOT EXISTS withdrawals (
  id              TEXT PRIMARY KEY,
  chain_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL REFERENCES users(id),
  to_address      TEXT NOT NULL,
  amount_nano     TEXT NOT NULL,
  fee_nano        TEXT NOT NULL DEFAULT '0',
  status          TEXT NOT NULL,            -- 'pending'|'sent'|'failed'
  tx_hash         TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  sent_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, created_at);

CREATE TABLE IF NOT EXISTS rounds (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  status            TEXT NOT NULL,           -- 'COUNTDOWN'|'LIVE'|'RESOLVED'|'REFUNDED'
  server_seed_hex   TEXT NOT NULL,
  server_seed_hash  TEXT NOT NULL,
  trajectory_seed_hex TEXT,
  pot_nano          TEXT NOT NULL DEFAULT '0',
  winner_user_id    TEXT REFERENCES users(id),
  winner_payout_nano TEXT,
  rake_nano         TEXT,
  resting_x         REAL,
  resting_y         REAL,
  started_at        INTEGER NOT NULL,
  countdown_ends_at INTEGER,
  resolved_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status);

CREATE TABLE IF NOT EXISTS bets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id        INTEGER NOT NULL REFERENCES rounds(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  amount_nano     TEXT NOT NULL,
  client_seed_hex TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE(round_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_bets_round ON bets(round_id);

CREATE TABLE IF NOT EXISTS chain_cursors (
  chain_id TEXT PRIMARY KEY,
  cursor   TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
