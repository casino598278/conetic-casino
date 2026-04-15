import { z } from "zod";

export const RoundPhase = z.enum(["IDLE", "COUNTDOWN", "LIVE", "RESOLVED"]);
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
  phase: RoundPhase,
  players: z.array(PlayerEntry),
  potNano: z.string(),
  countdownEndsAt: z.number().nullable(), // unix ms
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
  HALF_SIDE: 1.0,        // logical units; client scales to pixels
  SIM_DT_MS: 1000 / 60,  // fixed timestep
  MAX_SIM_MS: 6000,      // hard cap on a round animation
  BALL_RADIUS: 0.04,
  INITIAL_SPEED_MIN: 1.4,
  INITIAL_SPEED_MAX: 2.2,
  DAMPING_PER_SEC: 0.55, // velocity multiplier per second (e^(-t * (1-DAMPING)))
  STOP_SPEED: 0.05,      // below this, ball stops
  RAKE_BPS: 50,          // 0.5%
  BPS_DENOM: 10000,
} as const;
