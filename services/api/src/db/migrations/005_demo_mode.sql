-- Demo mode: per-user flag. When enabled, bets don't deduct real balance
-- and payouts don't credit real balance. Tracks a synthetic demo balance instead.

ALTER TABLE users ADD COLUMN demo_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN demo_balance_nano TEXT NOT NULL DEFAULT '10000000000'; -- 10 TON starter demo balance
