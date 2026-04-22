export * from "./reels.js";
export * from "./cosmicLines.js";
export * from "./fruitStorm.js";
export * from "./gemClusters.js";
export * from "./luckySevens.js";

/** Stable machine-readable list of slot variants — used by the API route
 *  switch and the client nav. Adding a new slot means editing this tuple. */
export const SLOT_VARIANTS = ["cosmicLines", "fruitStorm", "gemClusters", "luckySevens"] as const;
export type SlotVariant = (typeof SLOT_VARIANTS)[number];
