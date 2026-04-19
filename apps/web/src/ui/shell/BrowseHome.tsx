import { PillTabs } from "./PillTabs";
import { GameTile } from "./GameTile";
import { useNavStore, type BrowseCategory, type GameKey } from "../../state/navStore";

interface OriginalSpec {
  key: string;
  name: string;
  game: Exclude<GameKey, null>;
}

const ORIGINALS: OriginalSpec[] = [
  { key: "dice",  name: "Dice",  game: "dice"  },
  { key: "limbo", name: "Limbo", game: "limbo" },
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
      <PillTabs<BrowseCategory>
        tabs={CATEGORIES}
        active={category}
        onChange={setCategory}
      />

      {category === "originals" ? (
        <section className="stake-section">
          <header className="stake-section-head">
            <h2 className="stake-section-title">Originals</h2>
          </header>
          <div className="stake-tile-grid">
            {ORIGINALS.map((o) => (
              <GameTile
                key={o.key}
                game={o.key}
                name={o.name}
                onClick={() => openGame(o.game)}
              />
            ))}
          </div>
        </section>
      ) : (
        <section className="stake-section">
          <header className="stake-section-head">
            <h2 className="stake-section-title">Multiplayer</h2>
          </header>
          <div className="stake-tile-grid">
            {MULTIPLAYER.map((m) => (
              <GameTile
                key={m.key}
                game={m.key}
                name={m.name}
                sub={m.sub}
                onClick={() => openGame(m.game!)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
