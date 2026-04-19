import type { ShellTab } from "../../state/navStore";

interface Props {
  active: ShellTab;
  onChange: (t: ShellTab) => void;
}

interface Item {
  key: ShellTab;
  label: string;
  icon: JSX.Element;
}

const ITEMS: Item[] = [
  {
    key: "browse",
    label: "Casino",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    key: "bets",
    label: "My Bets",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 4h18v4H3z" />
        <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
        <line x1="10" y1="12" x2="14" y2="12" />
      </svg>
    ),
  },
  {
    key: "menu",
    label: "Menu",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="7" x2="21" y2="7" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="17" x2="21" y2="17" />
      </svg>
    ),
  },
];

export function BottomNav({ active, onChange }: Props) {
  return (
    <nav className="stake-bottomnav" role="tablist">
      {ITEMS.map((it) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={active === it.key}
          className={`stake-bottomnav-btn ${active === it.key ? "is-active" : ""}`}
          onClick={() => onChange(it.key)}
        >
          <span className="stake-bottomnav-icon">{it.icon}</span>
          <span className="stake-bottomnav-label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
