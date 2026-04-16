import { useCallback, useEffect, useState } from "react";
import { api } from "../net/api";

interface PublicRound {
  roundId: number;
  resolvedAt: number | null;
  potNano: string;
  winnerUserId: string | null;
  winnerUsername: string | null;
  winnerFirstName: string | null;
  winnerPhotoUrl: string | null;
  winnerPayoutNano: string | null;
  winnerStakeNano: string | null;
  multiplier: number;
  chance: number;
  playerCount: number;
}

const NANO = 1_000_000_000n;
function fmtTon(s: string | null | undefined): string {
  if (!s) return "0";
  const n = BigInt(s);
  const w = n / NANO;
  const f = (n % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

function fmtTime(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")} · ${d
    .getHours()
    .toString()
    .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

type Tab = "time" | "luckiest" | "biggest" | "mine";

interface Props {
  onClose: () => void;
}

export function HistoryModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>("time");
  const [rounds, setRounds] = useState<PublicRound[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const path =
      tab === "time" ? "/rounds/recent" :
      tab === "luckiest" ? "/rounds/luckiest" :
      tab === "biggest" ? "/rounds/biggest" :
      "/rounds/mine";
    api<PublicRound[]>(path)
      .then((rs) => setRounds(rs))
      .catch(() => setRounds([]))
      .finally(() => setLoading(false));
  }, [tab]);

  const filtered = search
    ? rounds.filter((r) => r.roundId.toString().includes(search))
    : rounds;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="history-header">
          <h3>Game history</h3>
          <button className="history-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>

        <div className="history-tabs">
          {(["time", "luckiest", "biggest", "mine"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`history-tab ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
              type="button"
            >
              {t === "time" ? "By time" : t === "luckiest" ? "Luckiest" : t === "biggest" ? "Biggest" : "My Games"}
            </button>
          ))}
        </div>

        <div className="history-search">
          <input
            placeholder="Search by game ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="history-list">
          {loading && <div className="empty">Loading…</div>}
          {!loading && filtered.length === 0 && <div className="empty">No games to show</div>}
          {filtered.map((r) => (
            <HistoryCard key={r.roundId} round={r} />
          ))}
        </div>

        <button className="bet-preset" style={{ width: "100%", marginTop: 12 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

interface Bet {
  userId: string;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  amountNano: string;
}

function HistoryCard({ round: r }: { round: PublicRound }) {
  const [expanded, setExpanded] = useState(false);
  const [bets, setBets] = useState<Bet[] | null>(null);

  const toggle = useCallback(() => {
    if (!expanded && bets === null) {
      api<Bet[]>(`/rounds/${r.roundId}/bets`).then(setBets).catch(() => setBets([]));
    }
    setExpanded((e) => !e);
  }, [expanded, bets, r.roundId]);

  return (
    <div className="history-card" onClick={toggle} style={{ cursor: "pointer" }}>
      <div className="history-card-row1">
        <span className="history-mult">{r.multiplier.toFixed(2)}x</span>
        <span className="history-meta">#{r.roundId} · {r.playerCount} {r.playerCount === 1 ? "player" : "players"}</span>
      </div>
      <div className="history-card-row2">
        <span className="history-avatar">
          {r.winnerPhotoUrl ? (
            <img src={`/api/avatar?url=${encodeURIComponent(r.winnerPhotoUrl)}`} alt="" />
          ) : (
            <span>{(r.winnerFirstName ?? r.winnerUsername ?? "?").slice(0, 2).toUpperCase()}</span>
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="history-name">
            {r.winnerUsername ? `@${r.winnerUsername}` : r.winnerFirstName ?? "—"}
          </div>
          <div className="history-time">{fmtTime(r.resolvedAt)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="history-amount">{fmtTon(r.winnerPayoutNano)} TON</div>
          <div className="history-chance">Chance <span>{(r.chance * 100).toFixed(2)}%</span></div>
        </div>
      </div>

      {expanded && bets && bets.length > 0 && (
        <div className="history-bets">
          {bets.map((b) => (
            <div className="history-bet-row" key={b.userId}>
              <span className="history-bet-avatar">
                {b.photoUrl ? (
                  <img src={`/api/avatar?url=${encodeURIComponent(b.photoUrl)}`} alt="" />
                ) : (
                  <span>{(b.firstName ?? b.username ?? "?").slice(0, 2).toUpperCase()}</span>
                )}
              </span>
              <span className="history-bet-name">
                {b.username ? `@${b.username}` : b.firstName ?? "—"}
              </span>
              <span className="history-bet-amount">{fmtTon(b.amountNano)} TON</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
