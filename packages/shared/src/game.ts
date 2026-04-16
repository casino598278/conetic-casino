import { z } from "zod";

export const RoundPhase = z.enum(["WAITING", "COUNTDOWN", "LIVE", "RESOLVED"]);
export type RoundPhase = z.infer<typeof RoundPhase>;

export const PlayerEntry = z.object({
  userId: z.string(),
  tgId: z.number().int(),
  username: z.string().nullable(),
  firstName: z.string(),
  photoUrl: z.string().nullable(),
  stakeNano: z.string(), // bigint as string for JSON safety
  clientSeedHex: z.string().length(32),
});
export type PlayerEntry = z.infer<typeof PlayerEntry>;

export const LobbySnapshot = z.object({
  roundId: z.number().int(),
  /** Sequential display counter (#1, #2, #3...) — increments on resolved rounds only. */
  displayId: z.number().int().optional(),
  phase: RoundPhase,
  players: z.array(PlayerEntry),
  potNano: z.string(),
  countdownEndsAt: z.number().nullable(),
  serverSeedHash: z.string().length(64).nullable(),
});
export type LobbySnapshot = z.infer<typeof LobbySnapshot>;

export const RoundResult = z.object({
  roundId: z.number().int(),
  winnerUserId: z.string(),
  winnerPayoutNano: z.string(),
  rakeNano: z.string(),
  serverSeedHex: z.string().length(64),
  serverSeedHash: z.string().length(64),
  clientSeedsHex: z.array(z.string().length(32)),
  macHex: z.string().length(64),
  trajectorySeedHex: z.string().length(64),
  // Final ball resting point (for verification + animation end)
  restingX: z.number(),
  restingY: z.number(),
});
export type RoundResult = z.infer<typeof RoundResult>;

// Arena geometry constants — shared so server + client agree.
export const ARENA = {
  HALF_SIDE: 1.0,            // logical units; client scales to pixels
  SIM_DT_MS: 1000 / 60,      // fixed timestep
  MAX_SIM_MS: 11000,         // hard cap on the spin+shoot animation
  BALL_RADIUS: 0.06,         // visual radius of the centre ball (in logical units)
  RAKE_BPS: 50,              // 0.5%
  BPS_DENOM: 10000,
} as const;
