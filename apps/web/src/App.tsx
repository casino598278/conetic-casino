import { useEffect, useState } from "react";
import { ArenaCanvas } from "./arena/ArenaCanvas";
import { BetBar } from "./ui/BetBar";
import { PlayersList } from "./ui/PlayersList";
import { WalletSheet } from "./ui/WalletSheet";
import { WinScreen } from "./ui/WinScreen";
import { GamePills } from "./ui/GamePills";
import { HistoryModal } from "./ui/HistoryModal";
import { useLobbyStore } from "./state/lobbyStore";
import { useWalletStore } from "./state/walletStore";
import { api, login } from "./net/api";
import { getSocket } from "./net/socket";
import { getInitData } from "./telegram/initWebApp";
import { SERVER_EVENTS, type LobbySnapshot, type RoundResult } from "@conetic/shared";

const NANO = 1_000_000_000n;
function fmtTon(nanoStr: string): string {
  const n = BigInt(nanoStr);
  const w = n / NANO;
  const f = (n % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

function useCountdown(endsAt: number | null): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (endsAt == null) return "—";
  const ms = Math.max(0, endsAt - now);
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function App() {
  const snapshot = useLobbyStore((s) => s.snapshot);
  const liveSeed = useLobbyStore((s) => s.liveTrajectorySeed);
  const liveStartedAt = useLobbyStore((s) => s.liveStartedAt);
  const lastResult = useLobbyStore((s) => s.lastResult);
  const setSnapshot = useLobbyStore((s) => s.setSnapshot);
  const setLive = useLobbyStore((s) => s.setLive);
  const setResult = useLobbyStore((s) => s.setResult);
  const clearLive = useLobbyStore((s) => s.clearLive);

  const user = useWalletStore((s) => s.user);
  const balance = useWalletStore((s) => s.balanceNano);
  const setUser = useWalletStore((s) => s.setUser);
  const setBalance = useWalletStore((s) => s.setBalance);

  const [showWallet, setShowWallet] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [winScreenVisible, setWinScreenVisible] = useState(false);
  const [pillsRefreshKey, setPillsRefreshKey] = useState(0);

  // Version watch — hard-reload if backend deployed a new build.
  useEffect(() => {
    let initial: string | null = null;
    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { buildId } = await res.json();
        if (initial == null) {
          initial = buildId;
          return;
        }
        if (buildId !== initial) {
          console.log("[version] new build detected, reloading");
          window.location.reload();
        }
      } catch {
        /* ignore */
      }
    };
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);

  // Auth + initial /me + WS subscribe.
  useEffect(() => {
    (async () => {
      try {
        const initData = getInitData();
        if (!initData) {
          setAuthError("No Telegram initData. Open via the bot or use ?devUser=1 in dev.");
          return;
        }
        const auth = await login(initData);
        setUser(auth.user);
        const me = await api<{ balanceNano: string }>("/me");
        setBalance(BigInt(me.balanceNano));

        const sock = getSocket();
        sock.on("connect", () => setWsConnected(true));
        sock.on("disconnect", () => setWsConnected(false));
        sock.on("connect_error", () => setWsConnected(false));
        if (sock.connected) setWsConnected(true);
        sock.on(SERVER_EVENTS.LobbyState, (s: LobbySnapshot) => setSnapshot(s));
        sock.on(SERVER_EVENTS.PlayerJoined, (e: { snapshot: LobbySnapshot }) => setSnapshot(e.snapshot));
        sock.on(SERVER_EVENTS.RoundCommit, (_e) => clearLive());
        sock.on(SERVER_EVENTS.RoundLive, (e: { trajectorySeedHex: string; startedAt: number }) =>
          setLive(e.trajectorySeedHex, e.startedAt),
        );
        sock.on(SERVER_EVENTS.RoundResult, async (r: RoundResult) => {
          setResult(r);
        });
        sock.on("balance:update", (b: { balanceNano: string }) => {
          setBalance(BigInt(b.balanceNano));
        });
      } catch (err: any) {
        setAuthError(err.message ?? "auth failed");
      }
    })();
  }, []);

  const countdown = useCountdown(snapshot?.countdownEndsAt ?? null);
  const isLive = !!liveSeed && snapshot?.phase === "LIVE";
  const phase = snapshot?.phase ?? "WAITING";
  const canBet = phase === "WAITING" || phase === "COUNTDOWN";
  const pot = snapshot?.potNano ?? "0";
  const playersJoined = snapshot?.players.length ?? 0;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // The server only emits RoundResult once the animation has finished, so we
  // just wait a short beat for the zoom-to-winner to play out in the arena.
  useEffect(() => {
    if (!lastResult) {
      setWinScreenVisible(false);
      return;
    }
    const t = setTimeout(() => {
      setWinScreenVisible(true);
      setPillsRefreshKey((k) => k + 1);
    }, 1200);
    return () => clearTimeout(t);
  }, [lastResult]);

  if (authError) {
    return (
      <div className="app">
        <div className="empty" style={{ padding: 32 }}>
          <h2>Conetic Casino</h2>
          <p>{authError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <button
          className="header-icon-btn"
          onClick={() => setShowHistory(true)}
          aria-label="Game history"
          type="button"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!wsConnected && <span className="ws-disconnected" title="Reconnecting…" />}
          <button className="balance-pill" onClick={() => setShowWallet(true)}>
            {fmtTon(balance.toString())} TON
          </button>
        </div>
      </header>

      <GamePills refreshKey={pillsRefreshKey} onOpenHistory={() => setShowHistory(true)} />

      <div className="pot-row">
        <div>Total <strong>{fmtTon(pot)}</strong></div>
        <div>
          {isLive ? (
            <span className="live">LIVE</span>
          ) : phase === "COUNTDOWN" ? (
            <span className="countdown">Starts in {countdown}</span>
          ) : phase === "RESOLVED" ? (
            <span className="live">Winner!</span>
          ) : (
            <span className="waiting">
              {playersJoined < 2
                ? `Waiting for players (${playersJoined}/2)`
                : "Starting…"}
            </span>
          )}
        </div>
      </div>

      <div className="arena-wrap">
        <div className="arena">
          <ArenaCanvas
            snapshot={snapshot}
            trajectorySeed={liveSeed}
            liveStartedAt={liveStartedAt}
            result={lastResult}
            currentUserId={user?.id ?? null}
          />
        </div>
      </div>

      <PlayersList snapshot={snapshot} />

      <BetBar disabled={!canBet} onError={(m) => showToast(m)} />

      <div className="tabs">
        <button className="active">Arena</button>
        <button onClick={() => setShowWallet(true)}>Wallet</button>
      </div>

      {showWallet && <WalletSheet onClose={() => setShowWallet(false)} />}
      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}

      {winScreenVisible && lastResult && snapshot && (() => {
        const winnerPlayer = snapshot.players.find((p) => p.userId === lastResult.winnerUserId);
        const username = winnerPlayer?.username ? `@${winnerPlayer.username}` : winnerPlayer?.firstName ?? "Winner";
        const stake = winnerPlayer ? BigInt(winnerPlayer.stakeNano) : 0n;
        const payout = BigInt(lastResult.winnerPayoutNano);
        const mult = stake > 0n ? Number(payout) / Number(stake) : 0;
        return (
          <WinScreen
            username={username}
            payoutNano={lastResult.winnerPayoutNano}
            multiplier={mult}
            photoUrl={winnerPlayer?.photoUrl ?? null}
            isMe={lastResult.winnerUserId === user?.id}
            onClose={() => setWinScreenVisible(false)}
          />
        );
      })()}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
