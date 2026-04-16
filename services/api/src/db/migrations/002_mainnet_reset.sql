-- Mainnet reset: wipe all testnet play-money data before launching for real.
-- Runs once (migrations table tracks applied files).

DELETE FROM ledger_entries;
DELETE FROM bets;
DELETE FROM rounds;
DELETE FROM deposits;
DELETE FROM withdrawals;
DELETE FROM chain_cursors;
DELETE FROM users;

-- Reset autoincrement counters so round IDs restart at 1.
DELETE FROM sqlite_sequence WHERE name IN ('rounds','bets','ledger_entries');
