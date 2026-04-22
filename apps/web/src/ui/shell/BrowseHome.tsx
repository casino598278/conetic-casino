import { PillTabs } from "./PillTabs";
import { GameTile } from "./GameTile";
import { useNavStore, type BrowseCategory, type GameKey } from "../../state/navStore";

interface TileSpec {
  key: string;
  name: string;
  sub?: string;
  game: Exclude<GameKey, null>;
}

const ORIGINALS: TileSpec[] = [
  { key: "dice",  name: "Dice",  game: "dice"  },
  { key: "limbo", name: "Limbo", game: "limbo" },
  { key: "keno",  name: "Keno",  game: "keno"  },
];

const MULTIPLAYER: TileSpec[] = [
  { key: "arena",  name: "Arena",  game: "arena"  },
  { key: "mining", name: "Mining", game: "mining" },
];

const SLOTS: TileSpec[] = [
  { key: "cosmicLines", name: "Cosmic Lines", sub: "5×3 · 10 lines",    game: "cosmicLines" },
  { key: "fruitStorm",  name: "Fruit Storm",  sub: "Tumble · Pay-any",  game: "fruitStorm"  },
  { key: "gemClusters", name: "Gem Clusters", sub: "7×7 · Cluster pays", game: "gemClusters" },
  { key: "luckySevens", name: "Lucky Sevens", sub: "3×3 · Hold & win",  game: "luckySevens" },
];

const CATEGORIES: { key: BrowseCategory; label: string }[] = [
  { key: "originals",   label: "Originals"   },
  { key: "slots",       label: "Slots"       },
  { key: "multiplayer", label: "Multiplayer" },
];

export function BrowseHome() {
  const category = useNavStore((s) => s.category);
  const setCategory = useNavStore((s) => s.setCategory);
  const openGame = useNavStore((s) => s.openGame);

  const section =
    category === "originals"   ? { title: "Originals",   tiles: ORIGINALS   }
  : category === "slots"       ? { title: "Slots",       tiles: SLOTS       }
  :                              { title: "Multiplayer", tiles: MULTIPLAYER };

  return (
    <div className="stake-browse">
      <PillTabs<BrowseCategory>
        tabs={CATEGORIES}
        active={category}
        onChange={setCategory}
      />

      <section className="stake-section">
        <header className="stake-section-head">
          <h2 className="stake-section-title">{section.title}</h2>
        </header>
        <div className="stake-tile-grid">
          {section.tiles.map((t) => (
            <GameTile
              key={t.key}
              game={t.key}
              name={t.name}
              sub={t.sub}
              onClick={() => openGame(t.game)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
