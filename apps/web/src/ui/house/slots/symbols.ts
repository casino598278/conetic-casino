// Central registry of every slot symbol used by SlotStage. Maps the string
// keys emitted by the shared slot math (e.g. "grape", "seven", "W") to:
//   - the SVG asset URL that Pixi should load
//   - an optional tint (used for Gem Clusters, where one gem.svg drives
//     all seven colour variants via Sprite.tint)
//
// Vite rewrites the `new URL(..., import.meta.url)` strings to hashed asset
// paths at build, and serves the raw SVG from /sprites/slots/*.svg in dev.

const base = (name: string) => new URL(`../../../../public/sprites/slots/${name}`, import.meta.url).href;

/** All unique SVG assets the stage needs to preload. Order doesn't matter. */
export const SYMBOL_ASSET_URLS = {
  cherry:  base("cherry.svg"),
  grape:   base("grape.svg"),
  apple:   base("apple.svg"),
  banana:  base("banana.svg"),
  plum:    base("plum.svg"),
  pear:    base("pear.svg"),
  lemon:   base("lemon.svg"),
  bell:    base("bell.svg"),
  bar:     base("bar.svg"),
  seven:   base("seven.svg"),
  star:    base("star.svg"),
  wild:    base("wild.svg"),
  scatter: base("scatter.svg"),
  coin:    base("coin.svg"),
  gem:     base("gem.svg"),
} as const;

export type SymbolAssetKey = keyof typeof SYMBOL_ASSET_URLS;

export interface SymbolSpec {
  /** Which asset texture to render. */
  asset: SymbolAssetKey;
  /** Pixi sprite tint as 0xRRGGBB. 0xFFFFFF = no tint (pure asset). */
  tint: number;
  /** Display label (for accessibility + DEV pay-table UI). */
  label: string;
  /** If true, wins involving this symbol get a stronger glow + haptic. */
  premium?: boolean;
}

/** Shared mapping: raw symbol string → what Pixi should draw.
 *  One table covers every variant. Unknown keys fall back to a generic gem. */
export const SYMBOL_SPECS: Record<string, SymbolSpec> = {
  // Fruit Storm — bright fruits
  grape:  { asset: "grape",  tint: 0xffffff, label: "Grape" },
  apple:  { asset: "apple",  tint: 0xffffff, label: "Apple" },
  plum:   { asset: "plum",   tint: 0xffffff, label: "Plum" },
  pear:   { asset: "pear",   tint: 0xffffff, label: "Pear" },
  banana: { asset: "banana", tint: 0xffffff, label: "Banana" },
  cherry: { asset: "cherry", tint: 0xffffff, label: "Cherry", premium: true },
  M:      { asset: "coin",   tint: 0xffffff, label: "Multiplier" },
  // Shared "scatter" key for Cosmic Lines + Fruit Storm
  S:      { asset: "scatter", tint: 0xffffff, label: "Scatter", premium: true },

  // Cosmic Lines
  lemon: { asset: "lemon", tint: 0xffffff, label: "Lemon" },
  bell:  { asset: "bell",  tint: 0xffffff, label: "Bell" },
  star:  { asset: "star",  tint: 0xffffff, label: "Star" },
  seven: { asset: "seven", tint: 0xffffff, label: "Seven", premium: true },
  W:     { asset: "wild",  tint: 0xffffff, label: "Wild", premium: true },

  // Gem Clusters — single gem.svg tinted per colour
  red:    { asset: "gem", tint: 0xff4d62, label: "Red gem" },
  orange: { asset: "gem", tint: 0xff9a3d, label: "Orange gem" },
  yellow: { asset: "gem", tint: 0xffd53d, label: "Yellow gem" },
  green:  { asset: "gem", tint: 0x3ecf8e, label: "Green gem" },
  teal:   { asset: "gem", tint: 0x36bac9, label: "Teal gem" },
  purple: { asset: "gem", tint: 0x9c5fe8, label: "Purple gem" },
  pink:   { asset: "gem", tint: 0xff6fb6, label: "Pink gem", premium: true },

  // Lucky Sevens (shares cherry, lemon, bell with Fruit Storm / Cosmic Lines)
  bar: { asset: "bar",   tint: 0xffffff, label: "BAR" },
  "7": { asset: "seven", tint: 0xffffff, label: "Seven", premium: true },
};

/** Fallback so a stray unknown symbol never crashes the renderer. */
export const FALLBACK_SPEC: SymbolSpec = {
  asset: "gem",
  tint: 0x666666,
  label: "?",
};

export function specFor(symbol: string): SymbolSpec {
  return SYMBOL_SPECS[symbol] ?? FALLBACK_SPEC;
}
