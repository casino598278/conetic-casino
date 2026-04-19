import { PillTabs } from "./PillTabs";
import { GameTile } from "./GameTile";
import { useNavStore, type BrowseCategory, type GameKey } from "../../state/navStore";

interface OriginalSpec {
  key: string;
  name: string;
  game: GameKey;
  enabled: boolean;
}

// Order matches stake.com/casino/group/stake-originals (from scrape, April 2026).
const ORIGINALS: OriginalSpec[] = [
  { key: "dice",   name: "Dice",   game: "dice",   enabled: true  },
  { key: "limbo",  name: "Limbo",  game: "limbo",  enabled: true  },
  { key: "mines",  name: "Mines",  game: null,     enabled: false },
  { key: "plinko", name: "Plinko", game: null,     enabled: false },
  { key: "keno",   name: "Keno",   game: null,     enabled: false },
  { key: "crash",  name: "Crash",  game: null,     enabled: false },
  { key: "hilo",   name: "Hilo",   game: null,     enabled: false },
  { key: "wheel",  name: "Wheel",  game: null,     enabled: false },
];

const MULTIPLAYER: { key: string; name: string; sub: string; game: GameKey }[] = [
  { key: "arena",  name: "Arena",  sub: "Free-for-all", game: "arena"  },
  { key: "mining", name: "Mining", sub: "Gem race",     game: "mining" },
];

const CATEGORIES: { key: BrowseCategory; label: string }[] = [
  { key: "originals",   label: "Originals"   },
  { key: "multiplayer", label: "Multiplayer" },
];

export function BrowseHome() {
  const category = useNavStore((s) => s.category);
  const setCategory = useNavStore((s) => s.setCategory);
  const openGame = useNavStore((s) => s.openGame);

  return (
    <div className="stake-browse">
      <div className="stake-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" />
        </svg>
        <input
          className="stake-search-input"
          placeholder="Search your game"
          readOnly
          aria-label="Search"
        />
      </div>

      <PillTabs<BrowseCategory>
        tabs={CATEGORIES}
        active={category}
        onChange={setCategory}
      />

      {category === "originals" ? (
        <section className="stake-section">
          <header className="stake-section-head">
            <h2 className="stake-section-title">
              <span className="stake-section-title-icon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15 9 22 9 16 14 18 21 12 17 6 21 8 14 2 9 9 9 12 2" />
                </svg>
              </span>
              Originals
            </h2>
            <span className="stake-section-count">
              {ORIGINALS.filter((o) => o.enabled).length}/{ORIGINALS.length}
            </span>
          </header>
          <div className="stake-tile-grid">
            {ORIGINALS.map((o) => (
              <GameTile
                key={o.key}
                game={o.key}
                name={o.name}
                badge={o.enabled ? null : "soon"}
                disabled={!o.enabled}
                onClick={o.enabled && o.game ? () => openGame(o.game!) : undefined}
              />
            ))}
          </div>
        </section>
      ) : (
        <section className="stake-section">
          <header className="stake-section-head">
            <h2 className="stake-section-title">
              <span className="stake-section-title-icon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="7" r="3" />
                  <circle cx="17" cy="10" r="3" />
                  <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
                  <path d="M14 20c0-2 2-4 4-4s4 2 4 4" />
                </svg>
              </span>
              Multiplayer
            </h2>
          </header>
          <div className="stake-tile-grid">
            {MULTIPLAYER.map((m) => (
              <GameTile
                key={m.key}
                game={m.key}
                name={m.name}
                sub={m.sub}
                badge="live"
                onClick={() => openGame(m.game!)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
