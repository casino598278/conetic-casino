import { create } from "zustand";
import type { LobbySnapshot, RoundResult } from "@conetic/shared";

interface LobbyState {
  snapshot: LobbySnapshot | null;
  liveTrajectorySeed: string | null;
  liveStartedAt: number | null;
  lastResult: RoundResult | null;
  setSnapshot: (s: LobbySnapshot) => void;
  setLive: (seed: string, startedAt: number) => void;
  setResult: (r: RoundResult) => void;
  clearLive: () => void;
}

export const useLobbyStore = create<LobbyState>((set) => ({
  snapshot: null,
  liveTrajectorySeed: null,
  liveStartedAt: null,
  lastResult: null,
  setSnapshot: (s) => set({ snapshot: s }),
  setLive: (seed, startedAt) =>
    set({ liveTrajectorySeed: seed, liveStartedAt: startedAt, lastResult: null }),
  setResult: (r) => set({ lastResult: r }),
  clearLive: () => set({ liveTrajectorySeed: null, liveStartedAt: null }),
}));
