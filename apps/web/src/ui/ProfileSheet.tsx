import { useEffect, useState } from "react";
import { api } from "../net/api";
import { useWalletStore } from "../state/walletStore";

interface ProfileStats {
  totalPlays: number;
  totalWagerNano: string;
  totalPayoutNano: string;
  netNano: string;
  wins: number;
  losses: number;
  biggestWinNano: string;
  biggestMultiplier: number;
  perGame: { game: string; plays: number; wagerNano: string; netNano: string }[];
}

const NANO = 1_000_000_000n;
function fmtTon(s: string): string {
  const n = BigInt(s);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const w = abs / NANO;
  const f = (abs % NANO).toString().padStart(9, "0").slice(0, 2).replace(/0+$/, "");
  const body = f ? `${w}.${f}` : `${w}`;
  return neg ? `−${body}` : body;
}

interface Props {
  onClose: () => void;
}

export function ProfileSheet({ onClose }: Props) {
  const user = useWalletStore((s) => s.user);
  const balance = useWalletStore((s) => s.balanceNano);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [anonEnabled, setAnonEnabled] = useState(false);
  const [anonName, setAnonName] = useState<string | null>(null);
  const [anonBusy, setAnonBusy] = useState(false);
  const [anonMsg, setAnonMsg] = useState<string | null>(null);

  useEffect(() => {
    api<ProfileStats>("/me/stats")
      .then(setStats)
      .catch(() => setErr("Couldn't load stats. Try again shortly."));
  }, []);

  // Fetch current anon state from /me on open.
  useEffect(() => {
    api<{ anonMode?: boolean; anonName?: string | null }>("/me")
      .then((me) => {
        setAnonEnabled(!!me.anonMode);
        setAnonName(me.anonName ?? null);
      })
      .catch(() => {});
  }, []);

  const toggleAnon = async () => {
    if (anonBusy) return;
    setAnonBusy(true);
    setAnonMsg(null);
    try {
      const res = await api<{ anonMode: boolean; anonName: string | null }>("/me/anon", {
        method: "POST",
        body: JSON.stringify({ enabled: !anonEnabled }),
      });
      setAnonEnabled(res.anonMode);
      setAnonName(res.anonName);
    } catch {
      setAnonMsg("Couldn't toggle anonymous mode");
    } finally {
      setAnonBusy(false);
    }
  };

  const displayName = user?.username ? `@${user.username}` : user?.firstName ?? "Player";
  const initial = (user?.firstName ?? user?.username ?? "?").slice(0, 1).toUpperCase();
  const winRate = stats && stats.totalPlays > 0
    ? (stats.wins / stats.totalPlays) * 100
    : null;
  const netPositive = stats ? BigInt(stats.netNano) >= 0n : false;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal profile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="history-header">
          <h3>Profile</h3>
          <button className="history-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>

        <div className="profile-head">
          <div className="profile-avatar">
            {user?.photoUrl ? (
              <img src={`/api/avatar?url=${encodeURIComponent(user.photoUrl)}`} alt="" />
            ) : (
              <span>{initial}</span>
            )}
          </div>
          <div className="profile-identity">
            <div className="profile-name">{displayName}</div>
            <div className="profile-balance">{fmtTon(balance.toString())} TON</div>
          </div>
        </div>

        {err && <div className="empty">{err}</div>}

        {!err && !stats && <div className="empty">Loading…</div>}

        {stats && (
          <>
            <div className="profile-kpis">
              <Kpi label="Total bets" value={String(stats.totalPlays)} />
              <Kpi label="Wagered" value={`${fmtTon(stats.totalWagerNano)} TON`} />
              <Kpi
                label="Net"
                value={`${fmtTon(stats.netNano)} TON`}
                tone={netPositive ? "win" : "loss"}
              />
              <Kpi
                label="Win rate"
                value={winRate == null ? "—" : `${winRate.toFixed(1)}%`}
              />
              <Kpi
                label="Biggest win"
                value={`${fmtTon(stats.biggestWinNano)} TON`}
                tone={BigInt(stats.biggestWinNano) > 0n ? "win" : undefined}
              />
              <Kpi
                label="Top multiplier"
                value={stats.biggestMultiplier > 0 ? `${stats.biggestMultiplier.toFixed(2)}×` : "—"}
              />
            </div>

            {stats.perGame.length > 0 && (
              <>
                <div className="profile-section-title">By game</div>
                <div className="profile-games">
                  {stats.perGame.map((g) => {
                    const gNet = BigInt(g.netNano);
                    const positive = gNet >= 0n;
                    return (
                      <div className="profile-game-row" key={g.game}>
                        <span className="profile-game-name">{g.game}</span>
                        <span className="profile-game-plays">{g.plays} bets</span>
                        <span
                          className={`profile-game-net ${positive ? "is-win" : "is-loss"}`}
                        >
                          {fmtTon(g.netNano)} TON
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        <div className="profile-section-title">Privacy</div>
        <div className="profile-setting-row">
          <div className="profile-setting-copy">
            <div className="profile-setting-name">Anonymous mode</div>
            <div className="profile-setting-sub">
              {anonEnabled && anonName
                ? `Shown as ${anonName} in games`
                : "Hide your name in games"}
            </div>
          </div>
          <button
            type="button"
            className={`profile-toggle ${anonEnabled ? "is-on" : ""}`}
            onClick={toggleAnon}
            disabled={anonBusy}
            aria-pressed={anonEnabled}
            aria-label="Anonymous mode"
          >
            <span className="profile-toggle-thumb" />
          </button>
        </div>
        {anonMsg && <div className="profile-setting-msg">{anonMsg}</div>}

        <button className="bet-preset" style={{ width: "100%", marginTop: 14 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "win" | "loss";
}) {
  return (
    <div className="profile-kpi">
      <div className="profile-kpi-lbl">{label}</div>
      <div
        className={`profile-kpi-val ${
          tone === "win" ? "is-win" : tone === "loss" ? "is-loss" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
