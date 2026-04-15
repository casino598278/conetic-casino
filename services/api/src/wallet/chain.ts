export type ChainId = "ton" | "sol" | "btc";

export interface IncomingDeposit {
  txHash: string;
  lt: string;          // logical time / sequence id from chain (string for any chain)
  amountNano: bigint;
  memo: string | null;
  fromAddress: string | null;
}

export interface ChainAdapter {
  readonly chainId: ChainId;
  readonly decimals: number;
  readonly network: "mainnet" | "testnet";

  /** Where users deposit. Returns the shared hot wallet + per-user memo. */
  getDepositTarget(userId: string, memo: string): { address: string; memo: string };

  /** Poll for new inbound transactions since cursor. Returns nextCursor and credits. */
  parseIncoming(cursor: string | null): Promise<{ nextCursor: string; credits: IncomingDeposit[] }>;

  /** Send a withdrawal. Idempotency must be enforced by caller via DB. */
  sendWithdrawal(input: {
    to: string;
    amountNano: bigint;
    idempotencyKey: string;
  }): Promise<{ txHash: string }>;

  validateAddress(addr: string): boolean;

  estimateFeeNano(amountNano: bigint): Promise<bigint>;
}
