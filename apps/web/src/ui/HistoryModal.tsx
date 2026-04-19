import { useEffect, useState } from "react";
import { api } from "../net/api";

interface UnifiedBet {
  source: "arena" | "mining" | "house";
  game: string;
  id: string;
  userId: string;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  betNano: string;
  payoutNano: string;
  multiplier: number;
  chance: number;
  createdAt: number;
}

const NANO = 1_000_000_000n;
function fmtTon(s: string | null | undefined): string {
  if (!s) return "0";
  const n = BigInt(s);
  const w = n / NANO;
  const f = (n % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}
function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")} · ${d
    .getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

type Tab = "recent" | "biggest" | "luckiest" | "mine";

interface Props {
  onClose: () => void;
}

export function HistoryModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>("recent");
  const [bets, setBets] = useState<UnifiedBet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const path = `/bets/${tab}`;
    api<UnifiedBet[]>(path)
      .then(setBets)
      .catch(() => setBets([]))
      .finally(() => setLoading(false));
  }, [tab]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="history-header">
          <h3>Bets</h3>
          <button className="history-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>

        <div className="history-tabs">
          {(["recent", "biggest", "luckiest", "mine"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`history-tab ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
              type="button"
            >
              {t === "recent" ? "Recent" : t === "biggest" ? "Biggest" : t === "luckiest" ? "Luckiest" : "My Bets"}
            </button>
          ))}
        </div>

        <div className="history-list">
          {loading && <div className="empty">Loading…</div>}
          {!loading && bets.length === 0 && <div className="empty">No bets yet</div>}
          {bets.map((b) => (
            <BetCard key={b.id} bet={b} />
          ))}
        </div>

        <button className="bet-preset" style={{ width: "100%", marginTop: 12 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function BetCard({ bet: b }: { bet: UnifiedBet }) {
  const betN = BigInt(b.betNano);
  const payoutN = BigInt(b.payoutNano);
  const won = payoutN > betN;
  const profit = payoutN - betN;
  const displayName = b.username ? `@${b.username}` : b.firstName ?? "—";
  const initials = (b.firstName ?? b.username ?? "?").replace(/^@/, "").slice(0, 2).toUpperCase();

  return (
    <div className="history-card">
      <div className="history-card-row1">
        <span className={`history-mult ${won ? "" : "is-loss"}`}>
          {won ? `${b.multiplier.toFixed(2)}×` : "Loss"}
        </span>
        <span className="history-meta">{b.game} · {fmtTime(b.createdAt)}</span>
      </div>
      <div className="history-card-row2">
        <span className="history-avatar">
          {b.photoUrl ? (
            <img src={`/api/avatar?url=${encodeURIComponent(b.photoUrl)}`} alt="" />
          ) : (
            <span>{initials}</span>
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="history-name">{displayName}</div>
          <div className="history-time">Bet {fmtTon(b.betNano)} TON</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className={`history-amount ${won ? "is-win" : "is-loss"}`}>
            {won ? `+${fmtTon(profit.toString())}` : `−${fmtTon(betN.toString())}`} TON
          </div>
        </div>
      </div>
    </div>
  );
}
