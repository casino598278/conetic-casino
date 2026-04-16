import { useEffect, useState } from "react";
import { api } from "../net/api";

interface Entry {
  rank: number;
  userId: string;
  username: string | null;
  firstName: string;
  photoUrl: string | null;
  totalWageredNano: string;
}

const NANO = 1_000_000_000n;
function fmtTon(s: string): string {
  const n = BigInt(s);
  const w = n / NANO;
  const f = (n % NANO).toString().padStart(9, "0").slice(0, 2).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

function fmtCountdown(totalSec: number): string {
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface Props {
  onClose: () => void;
}

export function Leaderboard({ onClose }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [resetIn, setResetIn] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ entries: Entry[]; resetInSeconds: number }>("/leaderboard")
      .then((d) => {
        setEntries(d.entries);
        setResetIn(d.resetInSeconds);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Live countdown
  useEffect(() => {
    if (resetIn <= 0) return;
    const t = setInterval(() => setResetIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resetIn > 0]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="history-header">
          <h3>Leaderboard</h3>
          <button className="history-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>

        <div style={{ textAlign: "center", color: "var(--t3)", fontSize: 12, marginBottom: 12 }}>
          Monthly wager · Resets in {fmtCountdown(resetIn)}
        </div>

        {loading && <div className="empty">Loading…</div>}
        {!loading && entries.length === 0 && <div className="empty">No wagers this month</div>}

        <div className="lb-list">
          {entries.map((e) => (
            <div className="lb-row" key={e.userId}>
              <span className="lb-rank">
                {e.rank <= 3 ? ["", "1st", "2nd", "3rd"][e.rank] : `#${e.rank}`}
              </span>
              <span className="lb-avatar">
                {e.photoUrl ? (
                  <img src={`/api/avatar?url=${encodeURIComponent(e.photoUrl)}`} alt="" />
                ) : (
                  <span>{e.firstName.slice(0, 2).toUpperCase()}</span>
                )}
              </span>
              <span className="lb-name">
                {e.username ? `@${e.username}` : e.firstName}
              </span>
              <span className="lb-amount">{fmtTon(e.totalWageredNano)} TON</span>
            </div>
          ))}
        </div>

        <button className="bet-preset" style={{ width: "100%", marginTop: 12 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
