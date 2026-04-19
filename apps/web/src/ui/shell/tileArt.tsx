/* Tile artwork — monochrome lines on a flat surface.
   One accent colour (sky blue) per game, no rainbows or chromatic gradients.
   160x200 viewBox, scales to fill. */

import type { JSX } from "react";

const STROKE = "#8d9ca8";       // c-text-2 — neutral line
const ACCENT = "#4cb8ff";        // c-accent — sky blue
const SURFACE = "#12181f";       // c-surface — tile background
const SURFACE_HI = "#1a2128";    // c-surface-2 — subtle lift

function Base({ children }: { children: JSX.Element }) {
  return (
    <svg viewBox="0 0 160 200" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <rect width="160" height="200" fill={SURFACE} />
      {children}
    </svg>
  );
}

const dice = (
  <g>
    <rect x="32" y="56" width="64" height="64" rx="10" fill={SURFACE_HI} stroke={STROKE} strokeWidth="1.5" />
    <rect x="68" y="92" width="64" height="64" rx="10" fill={SURFACE_HI} stroke={ACCENT} strokeWidth="1.5" />
    <circle cx="50" cy="74" r="4" fill={STROKE} />
    <circle cx="78" cy="102" r="4" fill={STROKE} />
    <circle cx="50" cy="102" r="4" fill={STROKE} />
    <circle cx="84" cy="108" r="3" fill={ACCENT} />
    <circle cx="116" cy="108" r="3" fill={ACCENT} />
    <circle cx="84" cy="140" r="3" fill={ACCENT} />
    <circle cx="116" cy="140" r="3" fill={ACCENT} />
    <circle cx="100" cy="124" r="3" fill={ACCENT} />
  </g>
);

const limbo = (
  <g>
    <line x1="24" y1="160" x2="136" y2="160" stroke={STROKE} strokeWidth="1" strokeOpacity="0.4" />
    <line x1="24" y1="120" x2="136" y2="120" stroke={STROKE} strokeWidth="1" strokeOpacity="0.2" />
    <line x1="24" y1="80" x2="136" y2="80" stroke={STROKE} strokeWidth="1" strokeOpacity="0.2" />
    <polyline
      points="24,150 58,130 88,90 128,40"
      stroke={ACCENT}
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="128" cy="40" r="4" fill={ACCENT} />
  </g>
);

const arena = (
  <g>
    <circle cx="80" cy="100" r="56" fill="none" stroke={STROKE} strokeWidth="1.5" strokeOpacity="0.4" />
    <circle cx="80" cy="100" r="40" fill="none" stroke={ACCENT} strokeWidth="1.5" />
    <circle cx="80" cy="100" r="5" fill={ACCENT} />
    <line x1="80" y1="44" x2="80" y2="64" stroke={STROKE} strokeWidth="1" strokeOpacity="0.4" />
    <line x1="80" y1="136" x2="80" y2="156" stroke={STROKE} strokeWidth="1" strokeOpacity="0.4" />
    <line x1="24" y1="100" x2="44" y2="100" stroke={STROKE} strokeWidth="1" strokeOpacity="0.4" />
    <line x1="116" y1="100" x2="136" y2="100" stroke={STROKE} strokeWidth="1" strokeOpacity="0.4" />
  </g>
);

const mining = (
  <g>
    <line x1="20" y1="150" x2="140" y2="150" stroke={STROKE} strokeWidth="1" strokeOpacity="0.4" />
    <polygon
      points="52,60 108,60 120,110 40,110"
      fill="none"
      stroke={STROKE}
      strokeWidth="1.5"
    />
    <polygon
      points="52,60 80,40 108,60 80,80"
      fill="none"
      stroke={ACCENT}
      strokeWidth="1.5"
    />
    <line x1="80" y1="40" x2="80" y2="110" stroke={STROKE} strokeWidth="1" strokeOpacity="0.5" />
    <line x1="40" y1="110" x2="80" y2="80" stroke={STROKE} strokeWidth="1" strokeOpacity="0.5" />
    <line x1="120" y1="110" x2="80" y2="80" stroke={STROKE} strokeWidth="1" strokeOpacity="0.5" />
  </g>
);

const TILE_ART: Record<string, JSX.Element> = {
  dice,
  limbo,
  arena,
  mining,
};

interface Props {
  game: string;
}

export function TileArt({ game }: Props) {
  const art = TILE_ART[game];
  if (!art) return <Base>{<g />}</Base>;
  return <Base>{art}</Base>;
}
