/* Swash Booze symbol art. Eleven symbols, each a standalone <svg> with
   radial-gradient fills, a specular highlight, and a drop shadow so they
   pop off the grid. Sized to fill their cell — viewBox 100x100, callers
   set width/height via CSS on the parent. */

import type { JSX } from "react";
import type { SwashSymbol } from "@conetic/shared";

interface Props {
  symbol: SwashSymbol;
  /** Small visual flicker when the symbol is winning this step. */
  winning?: boolean;
}

// ────────────────────────── shared building blocks ──────────────────────────

function GradientDefs({ id, color, highlight = "#ffffff" }: { id: string; color: string; highlight?: string }) {
  return (
    <defs>
      <radialGradient id={id} cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor={highlight} stopOpacity="0.85" />
        <stop offset="35%" stopColor={color} stopOpacity="1" />
        <stop offset="100%" stopColor={color} stopOpacity="1" />
      </radialGradient>
    </defs>
  );
}

function Highlight({ cx, cy, rx, ry, opacity = 0.45 }: { cx: number; cy: number; rx: number; ry: number; opacity?: number }) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#ffffff" opacity={opacity} />;
}

// ────────────────────────── symbols ──────────────────────────

/** Red heart candy (lowest-tier paying symbol). */
function RedHeart() {
  return (
    <svg viewBox="0 0 100 100" className="swash-sym">
      <GradientDefs id="g-red" color="#ef3357" />
      <path
        d="M50 85 C 22 64, 12 40, 30 26 C 42 18, 50 30, 50 36 C 50 30, 58 18, 70 26 C 88 40, 78 64, 50 85 Z"
        fill="url(#g-red)"
        stroke="#a01930"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <Highlight cx={40} cy={38} rx={10} ry={7} />
    </svg>
  );
}

/** Purple chamfered square candy. */
function PurpleSquare() {
  return (
    <svg viewBox="0 0 100 100" className="swash-sym">
      <GradientDefs id="g-purple" color="#c24bff" />
      <rect x="18" y="18" width="64" height="64" rx="14" fill="url(#g-purple)" stroke="#7c2eb8" strokeWidth="1.5" />
      <rect x="22" y="22" width="56" height="24" rx="8" fill="#ffffff" opacity="0.25" />
      <Highlight cx={38} cy={32} rx={14} ry={5} opacity={0.55} />
    </svg>
  );
}

/** Green pentagon candy. */
function GreenPentagon() {
  const pts = "50,15 86,40 72,82 28,82 14,40";
  return (
    <svg viewBox="0 0 100 100" className="swash-sym">
      <GradientDefs id="g-green" color="#4ede52" />
      <polygon points={pts} fill="url(#g-green)" stroke="#1f8e27" strokeWidth="1.5" strokeLinejoin="round" />
      <Highlight cx={44} cy={34} rx={14} ry={6} />
    </svg>
  );
}

/** Blue oval candy. */
function BlueOval() {
  return (
    <svg viewBox="0 0 100 100" className="swash-sym">
      <GradientDefs id="g-blue" color="#3bb5ff" />
      <ellipse cx="50" cy="50" rx="38" ry="24" fill="url(#g-blue)" stroke="#1b6fb0" strokeWidth="1.5" />
      <Highlight cx={40} cy={42} rx={18} ry={6} opacity={0.55} />
    </svg>
  );
}

/** Plum — purple round fruit with leaf. */
function Plum() {
  return (
    <svg viewBox="0 0 100 100" className="swash-sym">
      <GradientDefs id="g-plum" color="#8a3bd1" highlight="#dda7ff" />
      <circle cx="50" cy="55" r="32" fill="url(#g-plum)" stroke="#5a1f8f" strokeWidth="1.5" />
      <path d="M40 28 Q 50 18, 60 24 Q 52 28, 48 32 Z" fill="#44aa5c" stroke="#2d7c3f" strokeWidth="1" strokeLinejoin="round" />
      <Highlight cx={40} cy={46} rx={11} ry={5} />
    </svg>
  );
}

/** Apple — red with leaf. */
function Apple() {
  return (
    <svg viewBox="0 0 100 100" className="swash-sym">
      <GradientDefs id="g-apple" color="#e8332f" highlight="#ffb2a7" />
      <path
        d="M50 25 C 35 22, 18 30, 18 52 C 18 72, 32 85, 50 85 C 68 85, 82 72, 82 52 C 82 30, 65 22, 50 25 Z"
        fill="url(#g-apple)"
        stroke="#8a1c1a"
        strokeWidth="1.5"
      />
      <path d="M50 25 Q 48 14, 54 10 L 56 12 Q 52 18, 52 26 Z" fill="#7a3515" />
      <path d="M52 20 Q 62 12, 74 16 Q 66 26, 55 24 Z" fill="#46b35a" stroke="#2d7c3f" strokeWidth="1" />
      <Highlight cx={40} cy={42} rx={12} ry={5} />
    </svg>
  );
}

/** Watermelon — green rind + red wedge. */
function Watermelon() {
  return (
    <svg viewBox="0 0 100 100" className="swash-sym">
      <defs>
        <radialGradient id="g-wm-red" cx="50%" cy="55%" r="55%">
          <stop offset="0%" stopColor="#ff6f8d" />
          <stop offset="70%" stopColor="#ef2f4e" />
          <stop offset="100%" stopColor="#c01c36" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="34" fill="#2f8c3a" stroke="#1f5f25" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="28" fill="#9ddb72" />
      <circle cx="50" cy="50" r="23" fill="url(#g-wm-red)" />
      {/* seeds */}
      <ellipse cx="45" cy="47" rx="1.5" ry="2.2" fill="#2a1412" />
      <ellipse cx="55" cy="51" rx="1.5" ry="2.2" fill="#2a1412" />
      <ellipse cx="48" cy="60" rx="1.5" ry="2.2" fill="#2a1412" />
      <ellipse cx="58" cy="44" rx="1.5" ry="2.2" fill="#2a1412" />
      <Highlight cx={42} cy={42} rx={9} ry={3} opacity={0.5} />
    </svg>
  );
}

/** Grapes — cluster of purple spheres with leaf. */
function Grapes() {
  const positions: Array<[number, number]> = [
    [50, 32], [40, 46], [60, 46],
    [32, 60], [50, 62], [68, 60],
    [42, 76], [58, 76],
  ];
  return (
    <svg viewBox="0 0 100 100" className="swash-sym">
      <GradientDefs id="g-grape" color="#7a38d1" highlight="#d2a7ff" />
      <path d="M42 20 Q 50 10, 64 16 Q 56 24, 50 28 Z" fill="#46b35a" stroke="#2d7c3f" strokeWidth="1" />
      {positions.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="8.5" fill="url(#g-grape)" stroke="#4a1d8a" strokeWidth="0.8" />
      ))}
    </svg>
  );
}

/** Banana — yellow curved. */
function Banana() {
  return (
    <svg viewBox="0 0 100 100" className="swash-sym">
      <defs>
        <linearGradient id="g-banana" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffdf5d" />
          <stop offset="50%" stopColor="#f5be2e" />
          <stop offset="100%" stopColor="#c98412" />
        </linearGradient>
      </defs>
      <path
        d="M22 32 Q 32 20, 48 24 Q 72 30, 82 56 Q 82 74, 68 80 Q 66 72, 62 72 Q 54 76, 42 74 Q 24 68, 20 52 Q 18 38, 22 32 Z"
        fill="url(#g-banana)"
        stroke="#8a5a10"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M24 34 Q 34 28, 46 30" stroke="#ffe88a" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" />
      <ellipse cx="78" cy="58" rx="2" ry="6" fill="#7a450f" transform="rotate(15 78 58)" />
      <ellipse cx="20" cy="34" rx="2" ry="4" fill="#7a450f" />
    </svg>
  );
}

/** Lollipop scatter — pink & white swirl on a stick. */
function Lollipop() {
  return (
    <svg viewBox="0 0 100 100" className="swash-sym">
      <defs>
        <radialGradient id="g-lolli" cx="40%" cy="30%" r="65%">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="100%" stopColor="#ff4c7d" />
        </radialGradient>
      </defs>
      <rect x="48" y="52" width="4" height="40" fill="#d9a3bf" stroke="#8f6478" strokeWidth="0.8" />
      <circle cx="50" cy="42" r="30" fill="url(#g-lolli)" stroke="#c0164a" strokeWidth="1.6" />
      {/* Swirl: a spiral approximated with two arcs of alternating color */}
      <path
        d="M50 42
           m -22 0
           a 22 22 0 1 1 44 0
           a 22 22 0 1 1 -44 0
           M50 42
           m -14 0
           a 14 14 0 1 1 28 0
           a 14 14 0 1 1 -28 0
           M50 42
           m -6 0
           a 6 6 0 1 1 12 0
           a 6 6 0 1 1 -12 0"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.85"
      />
      <Highlight cx={36} cy={30} rx={10} ry={4} opacity={0.75} />
    </svg>
  );
}

/** Multiplier bomb — rainbow candy ball with fuse and value text. */
function Bomb({ value }: { value?: number }) {
  return (
    <svg viewBox="0 0 100 100" className="swash-sym">
      <defs>
        <radialGradient id="g-bomb" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffd1ff" />
          <stop offset="40%" stopColor="#ff65b5" />
          <stop offset="80%" stopColor="#aa2dd9" />
          <stop offset="100%" stopColor="#5a1388" />
        </radialGradient>
      </defs>
      {/* fuse */}
      <path d="M50 18 Q 60 8, 72 14" stroke="#f5be2e" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <circle cx="72" cy="14" r="3.5" fill="#ffdf5d" />
      <circle cx="72" cy="14" r="1.5" fill="#fff" />
      {/* body */}
      <circle cx="50" cy="55" r="32" fill="url(#g-bomb)" stroke="#3a0d63" strokeWidth="2" />
      <Highlight cx={38} cy={44} rx={11} ry={5} />
      {/* value text */}
      {value != null && (
        <text
          x="50"
          y="62"
          textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="22"
          fontWeight="900"
          fill="#fff"
          stroke="#3a0d63"
          strokeWidth="1"
          paintOrder="stroke"
        >
          {value}×
        </text>
      )}
    </svg>
  );
}

// ────────────────────────── dispatch ──────────────────────────

export function SwashSymbolIcon({ symbol, winning }: Props): JSX.Element {
  const inner = pick(symbol);
  return <span className={`swash-sym-wrap ${winning ? "is-winning" : ""}`}>{inner}</span>;
}

/** Variant that draws a bomb with its value shown. */
export function SwashBombIcon({ value, winning }: { value: number; winning?: boolean }): JSX.Element {
  return (
    <span className={`swash-sym-wrap swash-sym-bomb ${winning ? "is-winning" : ""}`}>
      <Bomb value={value} />
    </span>
  );
}

function pick(s: SwashSymbol): JSX.Element {
  switch (s) {
    case "red":        return <RedHeart />;
    case "purple":     return <PurpleSquare />;
    case "green":      return <GreenPentagon />;
    case "blue":       return <BlueOval />;
    case "plum":       return <Plum />;
    case "apple":      return <Apple />;
    case "watermelon": return <Watermelon />;
    case "grape":      return <Grapes />;
    case "banana":     return <Banana />;
    case "lollipop":   return <Lollipop />;
    case "bomb":       return <Bomb />;
  }
}
