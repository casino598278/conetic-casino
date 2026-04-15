import { useEffect, useState } from "react";
import { api } from "../net/api";

interface PublicRound {
  roundId: number;
  winnerUserId: string | null;
  winnerUsername: string | null;
  winnerFirstName: string | null;
  winnerPhotoUrl: string | null;
  winnerPayoutNano: string | null;
  potNano: string;
}

const NANO = 1_000_000_000n;
function fmtTon(nanoStr: string | null | undefined): string {
  if (!nanoStr) return "0";
  const n = BigInt(nanoStr);
  const w = n / NANO;
  const f = (n % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

interface Props {
  refreshKey?: number;
  onOpenHistory?: () => void;
}

export function GamePills({ refreshKey, onOpenHistory }: Props) {
  const [top, setTop] = useState<PublicRound | null>(null);
  const [last, setLast] = useState<PublicRound | null>(null);

  useEffect(() => {
    api<PublicRound | null>("/rounds/top").then(setTop).catch(() => {});
    api<PublicRound | null>("/rounds/last").then(setLast).catch(() => {});
  }, [refreshKey]);

  return (
    <div className="game-pills">
      <button className="game-pill" onClick={onOpenHistory} type="button">
        <div className="game-pill-label">Top game</div>
        {top?.winnerUserId ? (
          <div className="game-pill-row">
            <Avatar
              photoUrl={top.winnerPhotoUrl}
              firstName={top.winnerFirstName ?? top.winnerUsername ?? "?"}
            />
            <span className="game-pill-name">
              {top.winnerUsername ? `@${top.winnerUsername}` : top.winnerFirstName}
            </span>
            <span className="game-pill-amount">+{fmtTon(top.winnerPayoutNano)}</span>
          </div>
        ) : (
          <div className="game-pill-empty">no games yet</div>
        )}
      </button>
      <button className="game-pill" onClick={onOpenHistory} type="button">
        <div className="game-pill-label">Last game</div>
        {last?.winnerUserId ? (
          <div className="game-pill-row">
            <Avatar
              photoUrl={last.winnerPhotoUrl}
              firstName={last.winnerFirstName ?? last.winnerUsername ?? "?"}
            />
            <span className="game-pill-name">
              {last.winnerUsername ? `@${last.winnerUsername}` : last.winnerFirstName}
            </span>
            <span className="game-pill-amount">+{fmtTon(last.winnerPayoutNano)}</span>
          </div>
        ) : (
          <div className="game-pill-empty">no games yet</div>
        )}
      </button>
    </div>
  );
}

function Avatar({ photoUrl, firstName }: { photoUrl: string | null; firstName: string }) {
  const initials = firstName.replace(/^@/, "").slice(0, 2).toUpperCase();
  if (photoUrl) {
    return (
      <span className="game-pill-avatar">
        <img src={`/api/avatar?url=${encodeURIComponent(photoUrl)}`} alt="" />
      </span>
    );
  }
  return <span className="game-pill-avatar"><span>{initials}</span></span>;
}
