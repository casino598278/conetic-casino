-- Singleplayer (house) games: provably-fair seed state per user + play history.

CREATE TABLE house_game_seeds (
  user_id TEXT PRIMARY KEY,
  server_seed_hex TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  previous_server_seed_hex TEXT,
  client_seed_hex TEXT NOT NULL,
  nonce INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE house_game_plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,
  bet_nano TEXT NOT NULL,
  payout_nano TEXT NOT NULL,
  multiplier REAL NOT NULL,
  params_json TEXT NOT NULL,
  outcome_json TEXT NOT NULL,
  server_seed_hex TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  client_seed_hex TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_house_plays_user ON house_game_plays(user_id, created_at DESC);
CREATE INDEX idx_house_plays_game ON house_game_plays(game, created_at DESC);
