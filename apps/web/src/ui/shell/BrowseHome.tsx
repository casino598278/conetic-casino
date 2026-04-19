import { PillTabs } from "./PillTabs";
import { SingleLobby } from "../house/SingleLobby";
import { useNavStore, type BrowseCategory } from "../../state/navStore";

const CATEGORIES: { key: BrowseCategory; label: string }[] = [
  { key: "originals", label: "Originals" },
  { key: "multiplayer", label: "Multiplayer" },
  { key: "casino", label: "Casino" },
];

export function BrowseHome() {
  const category = useNavStore((s) => s.category);
  const setCategory = useNavStore((s) => s.setCategory);
  const openGame = useNavStore((s) => s.openGame);

  return (
    <div className="stake-browse">
      <div className="stake-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="stake-search-input"
          placeholder="Search games"
          readOnly
          aria-label="Search games (coming soon)"
        />
      </div>

      <PillTabs<BrowseCategory>
        tabs={CATEGORIES}
        active={category}
        onChange={setCategory}
      />

      {category === "originals" ? (
        <SingleLobby onPick={(g) => openGame(g as "dice")} />
      ) : category === "multiplayer" ? (
        <div className="stake-mp-grid">
          <button
            type="button"
            className="stake-mp-card"
            onClick={() => openGame("arena")}
          >
            <div className="stake-mp-card-emoji">⚔️</div>
            <div className="stake-mp-card-body">
              <div className="stake-mp-card-name">Arena</div>
              <div className="stake-mp-card-desc">Free-for-all wedge wager</div>
              <span className="stake-live-badge">LIVE</span>
            </div>
          </button>
          <button
            type="button"
            className="stake-mp-card"
            onClick={() => openGame("mining")}
          >
            <div className="stake-mp-card-emoji">⛏️</div>
            <div className="stake-mp-card-body">
              <div className="stake-mp-card-name">Mining</div>
              <div className="stake-mp-card-desc">Race to 301 gems</div>
              <span className="stake-live-badge">LIVE</span>
            </div>
          </button>
        </div>
      ) : (
        <div className="stake-empty">
          <p>Slots &amp; live tables coming soon.</p>
        </div>
      )}
    </div>
  );
}
