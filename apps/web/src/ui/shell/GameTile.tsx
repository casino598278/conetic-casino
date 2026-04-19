import { TileArt } from "./tileArt";

interface Props {
  game: string;
  name: string;
  sub?: string;
  disabled?: boolean;
  onClick?: () => void;
}

export function GameTile({ game, name, sub, disabled, onClick }: Props) {
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
      <div className="stake-tile-foot">
        <div className="stake-tile-name">{name}</div>
        {sub && <div className="stake-tile-sub">{sub}</div>}
      </div>
    </button>
  );
}
