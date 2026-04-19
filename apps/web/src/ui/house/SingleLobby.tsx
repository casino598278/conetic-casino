interface Tile {
  key: string;
  name: string;
  desc: string;
  emoji: string;
  available: boolean;
}

const TILES: Tile[] = [
  { key: "dice", name: "Dice", desc: "Roll 0–100 · pick over/under", emoji: "🎲", available: true },
  { key: "limbo", name: "Limbo", desc: "How high will it go?", emoji: "🚀", available: false },
  { key: "keno", name: "Keno", desc: "Pick your lucky cells", emoji: "🔢", available: false },
  { key: "plinko", name: "Plinko", desc: "Soon", emoji: "🧩", available: false },
  { key: "mines", name: "Mines", desc: "Soon", emoji: "💣", available: false },
  { key: "crash", name: "Crash", desc: "Soon", emoji: "📈", available: false },
];

interface Props {
  onPick: (game: string) => void;
}

export function SingleLobby({ onPick }: Props) {
  return (
    <div className="single-lobby">
      <div className="single-lobby-title">Singleplayer</div>
      <div className="single-tile-grid">
        {TILES.map((t) => (
          <button
            key={t.key}
            className={`single-tile ${t.available ? "" : "disabled"}`}
            disabled={!t.available}
            onClick={() => t.available && onPick(t.key)}
          >
            <div className="single-tile-emoji">{t.emoji}</div>
            <div className="single-tile-name">{t.name}</div>
            <div className="single-tile-desc">{t.available ? t.desc : "Coming soon"}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
