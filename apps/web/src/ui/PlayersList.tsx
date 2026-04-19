import { useState } from "react";
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
  const fracStr = (frac.toString().padStart(9, "0")).slice(0, 2).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

function HashPill({ hash }: { hash: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!hash) return null;
  const short = `${hash.slice(0, 2)}…${hash.slice(-4)}`;
  const copy = () => {
    navigator.clipboard?.writeText(hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <button className="hash-pill" type="button" onClick={copy} title="Server seed commit hash">
      Hash: <span>{short}</span>
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export function PlayersList({ snapshot }: Props) {
  if (!snapshot || snapshot.players.length === 0) {
    return (
      <div className="players-section">
        <div className="players-header">
          <h2>Players · 0</h2>
          <span className="meta">Game #{snapshot?.displayId ?? snapshot?.roundId ?? "—"}</span>
        </div>
        <div className="hash-row">
          <HashPill hash={snapshot?.serverSeedHash ?? null} />
        </div>
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
      <div className="hash-row">
        <HashPill hash={snapshot.serverSeedHash} />
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
                background: p.photoUrl
                  ? `url(/api/avatar?url=${encodeURIComponent(p.photoUrl)})`
                  : `#${color.toString(16).padStart(6, "0")}`,
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
