-- Anonymous mode flag per user + monthly wager tracking.

ALTER TABLE users ADD COLUMN anon_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN anon_name TEXT;

CREATE TABLE IF NOT EXISTS monthly_wagers (
  user_id     TEXT NOT NULL REFERENCES users(id),
  year_month  TEXT NOT NULL,   -- '2026-04'
  total_nano  TEXT NOT NULL DEFAULT '0',
  PRIMARY KEY (user_id, year_month)
);
CREATE INDEX IF NOT EXISTS idx_monthly_wagers_month ON monthly_wagers(year_month, CAST(total_nano AS INTEGER) DESC);
