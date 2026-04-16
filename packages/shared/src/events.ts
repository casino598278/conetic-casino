import { z } from "zod";
import { LobbySnapshot, RoundResult } from "./game.js";

// Server -> Client
export const SrvLobbyState = LobbySnapshot;
export const SrvLobbyTick = z.object({ countdownEndsAt: z.number().nullable() });
export const SrvPlayerJoined = z.object({ snapshot: LobbySnapshot });
export const SrvPlayerLeft = z.object({ snapshot: LobbySnapshot });
export const SrvRoundCommit = z.object({
  roundId: z.number().int(),
  serverSeedHash: z.string().length(64),
  countdownEndsAt: z.number(),
});
export const SrvRoundLive = z.object({
  roundId: z.number().int(),
  trajectorySeedHex: z.string().length(64),
  startedAt: z.number(),
});
export const SrvRoundResult = RoundResult;

export const SERVER_EVENTS = {
  LobbyState: "lobby:state",
  LobbyTick: "lobby:tick",
  PlayerJoined: "lobby:player_joined",
  PlayerLeft: "lobby:player_left",
  RoundCommit: "round:commit",
  RoundLive: "round:live",
  RoundResult: "round:result",
  // Mining game
  MiningState: "mining:state",
  MiningTick: "mining:tick",
  MiningCommit: "mining:commit",
  MiningLive: "mining:live",
  MiningResult: "mining:result",
  Error: "error",
} as const;

// Client -> Server
export const CliPlaceBet = z.object({
  amountNano: z.string(),
  clientSeedHex: z.string().length(32),
});

export const CLIENT_EVENTS = {
  PlaceBet: "bet:place",
} as const;
