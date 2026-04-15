import { z } from "zod";

export const AuthRequest = z.object({
  initData: z.string().min(1),
});
export const AuthResponse = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    tgId: z.number().int(),
    username: z.string().nullable(),
    firstName: z.string(),
    photoUrl: z.string().nullable(),
  }),
});

export const MeResponse = z.object({
  id: z.string(),
  tgId: z.number().int(),
  username: z.string().nullable(),
  firstName: z.string(),
  photoUrl: z.string().nullable(),
  balanceNano: z.string(),
});

export const DepositTargetResponse = z.object({
  chainId: z.literal("ton"),
  address: z.string(),
  memo: z.string(),
  network: z.enum(["mainnet", "testnet"]),
});

export const WithdrawRequest = z.object({
  toAddress: z.string().min(48).max(70),
  amountNano: z.string(),
});
export const WithdrawResponse = z.object({
  withdrawalId: z.string(),
  status: z.enum(["pending", "sent", "failed"]),
});

export const RoundHistoryEntry = z.object({
  roundId: z.number().int(),
  startedAt: z.number(),
  resolvedAt: z.number(),
  potNano: z.string(),
  winnerUserId: z.string(),
  winnerUsername: z.string().nullable(),
  serverSeedHex: z.string().length(64),
  serverSeedHash: z.string().length(64),
  clientSeedsHex: z.array(z.string().length(32)),
});
export const RoundHistoryResponse = z.array(RoundHistoryEntry);
