/* Minimalist tile artwork. One <svg> per game; no external assets.
   Each draws into a 160x200 viewbox, scales to fill, with a subtle
   gradient background keyed per game. */

import type { JSX } from "react";

interface Spec {
  gradient: [string, string];
  render: () => JSX.Element;
}

const dice = (
  <g>
    <rect x="36" y="38" width="60" height="60" rx="10" fill="#ffffff" opacity="0.95" />
    <rect x="64" y="70" width="60" height="60" rx="10" fill="#ffffff" opacity="0.7" />
    <circle cx="52" cy="54" r="5" fill="#0f212e" />
    <circle cx="80" cy="82" r="5" fill="#0f212e" />
    <circle cx="52" cy="82" r="5" fill="#0f212e" />
    <circle cx="80" cy="100" r="5" fill="#0f212e" opacity="0.5" />
    <circle cx="108" cy="100" r="5" fill="#0f212e" opacity="0.5" />
    <circle cx="80" cy="128" r="5" fill="#0f212e" opacity="0.5" />
    <circle cx="108" cy="128" r="5" fill="#0f212e" opacity="0.5" />
  </g>
);

const limbo = (
  <g>
    <path d="M20 150 L80 50 L140 110" stroke="#00e701" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="140" cy="110" r="7" fill="#00e701" />
    <text x="80" y="36" fontFamily="ui-sans-serif, sans-serif" fontSize="22" fontWeight="800" fill="#ffffff" textAnchor="middle">2.40×</text>
  </g>
);

const mines = (
  <g>
    <rect x="30" y="40" width="30" height="30" rx="4" fill="#ffffff" opacity="0.12" />
    <rect x="65" y="40" width="30" height="30" rx="4" fill="#ffffff" opacity="0.12" />
    <rect x="100" y="40" width="30" height="30" rx="4" fill="#ffffff" opacity="0.12" />
    <rect x="30" y="75" width="30" height="30" rx="4" fill="#ffffff" opacity="0.12" />
    <rect x="100" y="75" width="30" height="30" rx="4" fill="#ffffff" opacity="0.12" />
    <rect x="30" y="110" width="30" height="30" rx="4" fill="#ffffff" opacity="0.12" />
    <rect x="65" y="110" width="30" height="30" rx="4" fill="#ffffff" opacity="0.12" />
    <rect x="100" y="110" width="30" height="30" rx="4" fill="#ffffff" opacity="0.12" />
    <g transform="translate(80 90)">
      <circle r="11" fill="#ed4163" />
      <path d="M-6 -6 L6 6 M6 -6 L-6 6" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
    </g>
  </g>
);

const plinko = (
  <g>
    {Array.from({ length: 6 }).map((_, row) =>
      Array.from({ length: row + 3 }).map((_, col) => {
        const x = 80 + (col - (row + 2) / 2) * 14;
        const y = 30 + row * 18;
        return <circle key={`${row}-${col}`} cx={x} cy={y} r="2.5" fill="#ffffff" opacity="0.6" />;
      }),
    )}
    <circle cx="80" cy="22" r="5" fill="#00e701">
      <animate attributeName="cy" values="22;140;22" dur="3s" repeatCount="indefinite" />
    </circle>
  </g>
);

const keno = (
  <g>
    {[0, 1, 2, 3, 4].map((r) =>
      [0, 1, 2, 3, 4].map((c) => {
        const x = 24 + c * 24;
        const y = 36 + r * 24;
        const hit = (r * 5 + c) % 7 === 0;
        return (
          <rect
            key={`${r}-${c}`}
            x={x}
            y={y}
            width="20"
            height="20"
            rx="3"
            fill={hit ? "#00e701" : "#ffffff"}
            opacity={hit ? 1 : 0.15}
          />
        );
      }),
    )}
  </g>
);

const crash = (
  <g>
    <path d="M10 160 Q50 160 70 120 Q90 80 150 20" stroke="#00e701" strokeWidth="3.5" fill="none" strokeLinecap="round" />
    <circle cx="150" cy="20" r="6" fill="#00e701" />
    <text x="80" y="62" fontFamily="ui-sans-serif, sans-serif" fontSize="18" fontWeight="800" fill="#ffffff">8.42×</text>
  </g>
);

const hilo = (
  <g>
    <rect x="32" y="42" width="46" height="64" rx="6" fill="#ffffff" />
    <rect x="82" y="42" width="46" height="64" rx="6" fill="#ffffff" opacity="0.5" />
    <text x="55" y="82" fontFamily="ui-sans-serif, sans-serif" fontSize="28" fontWeight="800" fill="#ed4163" textAnchor="middle">K</text>
    <text x="55" y="102" fontFamily="ui-sans-serif, sans-serif" fontSize="16" fontWeight="800" fill="#ed4163" textAnchor="middle">♥</text>
    <path d="M80 130 L105 115 L130 130" stroke="#00e701" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M80 160 L105 145 L130 160" stroke="#ed4163" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
  </g>
);

const wheel = (
  <g>
    <circle cx="80" cy="100" r="55" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.25" />
    {Array.from({ length: 12 }).map((_, i) => {
      const a = (i * 30 - 90) * (Math.PI / 180);
      const x = 80 + Math.cos(a) * 55;
      const y = 100 + Math.sin(a) * 55;
      const colors = ["#00e701", "#ffffff", "#ed4163", "#ffffff"];
      return <circle key={i} cx={x} cy={y} r="6" fill={colors[i % 4]} opacity="0.9" />;
    })}
    <polygon points="80,36 73,50 87,50" fill="#ffb636" />
    <circle cx="80" cy="100" r="6" fill="#ffb636" />
  </g>
);

const arena = (
  <g>
    <circle cx="80" cy="100" r="58" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.2" />
    <path d="M 80 42 A 58 58 0 0 1 130 90 L 80 100 Z" fill="#00e701" opacity="0.8" />
    <path d="M 130 90 A 58 58 0 0 1 118 140 L 80 100 Z" fill="#3bc8ff" opacity="0.7" />
    <path d="M 118 140 A 58 58 0 0 1 42 140 L 80 100 Z" fill="#ffb636" opacity="0.7" />
    <path d="M 42 140 A 58 58 0 0 1 30 90 L 80 100 Z" fill="#ed4163" opacity="0.7" />
    <path d="M 30 90 A 58 58 0 0 1 80 42 L 80 100 Z" fill="#9ae9eb" opacity="0.7" />
    <circle cx="80" cy="100" r="8" fill="#0f212e" />
  </g>
);

const mining = (
  <g>
    <rect x="30" y="130" width="100" height="28" rx="4" fill="#ffffff" opacity="0.15" />
    <polygon points="60,40 90,40 100,70 50,70" fill="#00e701" />
    <polygon points="60,40 75,30 90,40 75,55" fill="#5cff5d" />
    <polygon points="100,80 120,80 118,110 102,110" fill="#9ae9eb" opacity="0.9" />
    <polygon points="40,85 55,85 53,108 42,108" fill="#ed4163" opacity="0.85" />
    <polygon points="70,90 82,90 80,105 72,105" fill="#ffb636" opacity="0.9" />
  </g>
);

export const TILE_ART: Record<string, Spec> = {
  dice:   { gradient: ["#1a3948", "#0e2230"], render: () => dice },
  limbo:  { gradient: ["#1a3a2a", "#0b1923"], render: () => limbo },
  mines:  { gradient: ["#3d1824", "#12161a"], render: () => mines },
  plinko: { gradient: ["#1f2a4a", "#0b1923"], render: () => plinko },
  keno:   { gradient: ["#1a3948", "#0e2230"], render: () => keno },
  crash:  { gradient: ["#1a3a2a", "#0b1923"], render: () => crash },
  hilo:   { gradient: ["#2a1a3a", "#12161a"], render: () => hilo },
  wheel:  { gradient: ["#3a2a10", "#12161a"], render: () => wheel },
  arena:  { gradient: ["#1a2c38", "#0b1923"], render: () => arena },
  mining: { gradient: ["#2a2010", "#12161a"], render: () => mining },
};

interface Props {
  game: string;
}

export function TileArt({ game }: Props) {
  const spec = TILE_ART[game];
  if (!spec) return null;
  const id = `tile-grad-${game}`;
  return (
    <svg viewBox="0 0 160 200" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={spec.gradient[0]} />
          <stop offset="100%" stopColor={spec.gradient[1]} />
        </linearGradient>
      </defs>
      <rect width="160" height="200" fill={`url(#${id})`} />
      {spec.render()}
    </svg>
  );
}
