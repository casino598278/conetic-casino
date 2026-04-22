import { create } from "zustand";

export type ShellTab = "browse" | "bets" | "menu";
export type BrowseCategory = "originals" | "multiplayer" | "slots";
export type GameKey =
  | "arena"
  | "mining"
  | "dice"
  | "limbo"
  | "keno"
  | "cosmicLines"
  | "fruitStorm"
  | "gemClusters"
  | "luckySevens"
  | null;

const VALID_GAMES: Exclude<GameKey, null>[] = [
  "arena", "mining", "dice", "limbo", "keno",
  "cosmicLines", "fruitStorm", "gemClusters", "luckySevens",
];
const VALID_CATEGORIES: BrowseCategory[] = ["originals", "multiplayer", "slots"];

function parseInitialGame(): GameKey {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get("game");
  if (!q) return null;
  return (VALID_GAMES as string[]).includes(q) ? (q as GameKey) : null;
}

function parseInitialCategory(): BrowseCategory {
  if (typeof window === "undefined") return "originals";
  const q = new URLSearchParams(window.location.search).get("cat");
  if (q && (VALID_CATEGORIES as string[]).includes(q)) return q as BrowseCategory;
  const g = parseInitialGame();
  if (g === "arena" || g === "mining") return "multiplayer";
  if (g === "cosmicLines" || g === "fruitStorm" || g === "gemClusters" || g === "luckySevens") return "slots";
  return "originals";
}

interface NavState {
  tab: ShellTab;
  category: BrowseCategory;
  activeGame: GameKey;
  setTab: (t: ShellTab) => void;
  setCategory: (c: BrowseCategory) => void;
  openGame: (g: Exclude<GameKey, null>) => void;
  closeGame: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  tab: "browse",
  category: parseInitialCategory(),
  activeGame: parseInitialGame(),
  setTab: (tab) => set({ tab }),
  setCategory: (category) => set({ category }),
  openGame: (g) => set({ activeGame: g, tab: "browse" }),
  closeGame: () => set({ activeGame: null }),
}));
