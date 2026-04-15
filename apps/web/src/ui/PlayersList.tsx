import type { LobbySnapshot } from "@conetic/shared";
import { colorForUser } from "../arena/colors";

interface Props {
  snapshot: LobbySnapshot | null;
}

const NANO = 1_000_000_000n;

function fmtTon(nanoStr: string): string {
  const nano = BigInt(nanoStr);
  const whole = nano / NANO;
  const frac = nano % NANO;
  const fracStr = (frac.toString().padStart(9, "0")).slice(0, 4).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

export function PlayersList({ snapshot }: Props) {
  if (!snapshot || snapshot.players.length === 0) {
    return (
      <div className="players-section">
        <div className="players-header">
          <h2>Players · 0</h2>
          <span className="meta">Game #{snapshot?.roundId ?? "—"}</span>
        </div>
        <div className="empty">Be the first to stake — invite a friend.</div>
      </div>
    );
  }
  const pot = BigInt(snapshot.potNano);
  return (
    <div className="players-section">
      <div className="players-header">
        <h2>Players · {snapshot.players.length}</h2>
        <span className="meta">Game #{snapshot.roundId}</span>
      </div>
      {snapshot.players.map((p) => {
        const stake = BigInt(p.stakeNano);
        const pct = pot > 0n ? Number((stake * 10000n) / pot) / 100 : 0;
        const color = colorForUser(p.userId);
        const initials = (p.firstName ?? "?").slice(0, 2).toUpperCase();
        return (
          <div className="player-row" key={p.userId}>
            <div
              className="avatar"
              style={{
                background: p.photoUrl ? `url(${p.photoUrl})` : `#${color.toString(16).padStart(6, "0")}`,
                backgroundSize: "cover",
              }}
            >
              {!p.photoUrl && initials}
            </div>
            <div className="info">
              <div className="name">{p.username ? `@${p.username}` : p.firstName}</div>
              <div className="pct">{pct.toFixed(2)}%</div>
            </div>
            <div className="stake">{fmtTon(p.stakeNano)} TON</div>
          </div>
        );
      })}
    </div>
  );
}
