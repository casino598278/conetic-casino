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
    label: "Browse",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    key: "favourites",
    label: "Favourites",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    ),
  },
  {
    key: "bets",
    label: "Bets",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 3 3 5-6" />
      </svg>
    ),
  },
  {
    key: "wallet",
    label: "Wallet",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 12V8a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h13v4" />
        <path d="M3 6v12a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-4h-5a2 2 0 0 1 0-4h5" />
      </svg>
    ),
  },
  {
    key: "menu",
    label: "Menu",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
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
