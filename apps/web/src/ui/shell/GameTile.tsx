import { TileArt } from "./tileArt";

interface Props {
  game: string;
  name: string;
  sub?: string;
  badge?: "live" | "soon" | null;
  disabled?: boolean;
  onClick?: () => void;
}

export function GameTile({ game, name, sub, badge, disabled, onClick }: Props) {
  return (
    <button
      type="button"
      className={`stake-tile ${disabled ? "is-disabled" : ""}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={name}
    >
      <div className="stake-tile-art">
        <TileArt game={game} />
      </div>
      {badge === "live" && <span className="stake-tile-badge is-live">Live</span>}
      {badge === "soon" && <span className="stake-tile-badge is-soon">Soon</span>}
      <div className="stake-tile-foot">
        <div className="stake-tile-name">{name}</div>
        {sub && <div className="stake-tile-sub">{sub}</div>}
      </div>
    </button>
  );
}
