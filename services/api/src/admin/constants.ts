// Server-side admin constants. Single source of truth for who has admin
// powers and the ledger thresholds that gate sensitive actions.

/** Telegram ID of the operator. Only this user can run /topup, receive
 *  large-withdrawal approval pings, etc. */
export const ADMIN_TG_ID = 6712382929;

/** Withdrawals >= this size require the admin to co-sign via Telegram.
 *  Matches the product policy in routes.wallet.ts. */
export const ADMIN_APPROVAL_THRESHOLD_NANO = 50n * 1_000_000_000n; // 50 TON
