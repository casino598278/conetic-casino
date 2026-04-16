import { create } from "zustand";
import type { MiningSnapshot, MiningResultEvent } from "@conetic/shared";

interface MiningState {
  snapshot: MiningSnapshot | null;
  liveTrajectorySeed: string | null;
  liveStartedAt: number | null;
  lastResult: MiningResultEvent | null;
  setSnapshot: (s: MiningSnapshot) => void;
  setLive: (seed: string, startedAt: number) => void;
  setResult: (r: MiningResultEvent) => void;
  clearLive: () => void;
}

export const useMiningStore = create<MiningState>((set) => ({
  snapshot: null,
  liveTrajectorySeed: null,
  liveStartedAt: null,
  lastResult: null,
  setSnapshot: (s) => set({ snapshot: s }),
  setLive: (seed, startedAt) => set({ liveTrajectorySeed: seed, liveStartedAt: startedAt, lastResult: null }),
  setResult: (r) => set({ lastResult: r }),
  clearLive: () => set({ liveTrajectorySeed: null, liveStartedAt: null, lastResult: null }),
}));
