import { create } from "zustand";

export type ShellTab = "browse" | "favourites" | "bets" | "wallet" | "menu";
export type BrowseCategory = "originals" | "multiplayer" | "casino";
export type GameKey = "arena" | "mining" | "dice" | null;

const VALID_GAMES: Exclude<GameKey, null>[] = ["arena", "mining", "dice"];
const VALID_CATEGORIES: BrowseCategory[] = ["originals", "multiplayer", "casino"];

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
  // If deep-linking into Arena/Mining, default category to multiplayer so Back feels right.
  const g = parseInitialGame();
  if (g === "arena" || g === "mining") return "multiplayer";
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
