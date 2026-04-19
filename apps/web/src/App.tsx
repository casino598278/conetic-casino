import { useEffect, useState } from "react";
import { ArenaCanvas } from "./arena/ArenaCanvas";
import { BetBar } from "./ui/BetBar";
import { PlayersList } from "./ui/PlayersList";
import { WalletSheet } from "./ui/WalletSheet";
import { WinScreen } from "./ui/WinScreen";
import { HistoryModal } from "./ui/HistoryModal";
import { Leaderboard } from "./ui/Leaderboard";
import { MiningGame } from "./ui/MiningGame";
import { Dice } from "./ui/house/Dice";
import { FairnessDrawer } from "./ui/house/FairnessDrawer";
import { AppShell } from "./ui/shell/AppShell";
import { BrowseHome } from "./ui/shell/BrowseHome";
import { useMiningStore } from "./state/miningStore";
import { useLobbyStore } from "./state/lobbyStore";
import { useWalletStore } from "./state/walletStore";
import { useNavStore } from "./state/navStore";
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
  const s = Math.max(1, Math.ceil(ms / 1000));
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

  const tab = useNavStore((s) => s.tab);
  const activeGame = useNavStore((s) => s.activeGame);
  const closeGame = useNavStore((s) => s.closeGame);
  const setTab = useNavStore((s) => s.setTab);

  const [showWallet, setShowWallet] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [fairnessOpen, setFairnessOpen] = useState(false);

  const miningSnap = useMiningStore((s) => s.snapshot);
  const miningSeed = useMiningStore((s) => s.liveTrajectorySeed);
  const miningStartedAt = useMiningStore((s) => s.liveStartedAt);
  const miningResult = useMiningStore((s) => s.lastResult);
  const setMiningSnap = useMiningStore((s) => s.setSnapshot);
  const setMiningLive = useMiningStore((s) => s.setLive);
  const setMiningResult = useMiningStore((s) => s.setResult);
  const clearMiningLive = useMiningStore((s) => s.clearLive);
  const [authError, setAuthError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, setWsConnected] = useState(false);
  const [winScreenVisible, setWinScreenVisible] = useState(false);

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
        // Mining game events
        sock.on(SERVER_EVENTS.MiningState, (s: any) => setMiningSnap(s));
        sock.on(SERVER_EVENTS.MiningCommit, () => clearMiningLive());
        sock.on(SERVER_EVENTS.MiningLive, (e: { trajectorySeedHex: string; startedAt: number }) =>
          setMiningLive(e.trajectorySeedHex, e.startedAt),
        );
        sock.on(SERVER_EVENTS.MiningResult, (r: any) => setMiningResult(r));
      } catch (err: any) {
        setAuthError(err.message ?? "auth failed");
      }
    })();
  }, []);

  // When bottom-nav tab changes to wallet/bets, open the matching sheet and
  // bounce the tab back to "browse" so reopening the sheet works.
  useEffect(() => {
    if (tab === "wallet") {
      setShowWallet(true);
      setTab("browse");
    } else if (tab === "bets") {
      setShowHistory(true);
      setTab("browse");
    } else if (tab === "menu") {
      setShowLeaderboard(true);
      setTab("browse");
    }
  }, [tab, setTab]);

  const countdown = useCountdown(snapshot?.countdownEndsAt ?? null);
  const isLive = !!liveSeed || snapshot?.phase === "LIVE";
  const phase = snapshot?.phase ?? "WAITING";
  const canBet = phase === "WAITING" || phase === "COUNTDOWN";
  const pot = snapshot?.potNano ?? "0";
  const playersJoined = snapshot?.players.length ?? 0;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    if (!lastResult) {
      setWinScreenVisible(false);
      return;
    }
    const t = setTimeout(() => {
      setWinScreenVisible(true);
    }, 1200);
    return () => clearTimeout(t);
  }, [lastResult]);

  // Block access outside Telegram Mini App — show blank white page.
  const isTelegram = !!window.Telegram?.WebApp?.initData;
  if (!isTelegram && !new URLSearchParams(window.location.search).has("devUser")) {
    return <div style={{ background: "#fff", height: "100vh", width: "100vw" }} />;
  }

  if (authError) {
    return (
      <div className="app">
        <div className="empty" style={{ padding: 32 }}>
          <p>{authError}</p>
        </div>
      </div>
    );
  }

  const renderGame = () => {
    if (tab === "favourites") {
      return <div className="stake-empty"><p>No favourites yet.</p></div>;
    }

    if (!activeGame) return <BrowseHome />;

    const back = (
      <button type="button" className="stake-game-back" onClick={closeGame}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>
    );

    if (activeGame === "dice") {
      return (
        <>
          {back}
          <Dice
            onBack={closeGame}
            onError={showToast}
            onOpenFairness={() => setFairnessOpen(true)}
          />
        </>
      );
    }

    if (activeGame === "arena") {
      return (
        <>
          {back}
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
        </>
      );
    }

    if (activeGame === "mining") {
      return (
        <>
          {back}
          <MiningGame
            snapshot={miningSnap}
            trajectorySeed={miningSeed}
            liveStartedAt={miningStartedAt}
            result={miningResult}
            currentUserId={user?.id ?? null}
            onError={(m) => showToast(m)}
          />
        </>
      );
    }

    return <BrowseHome />;
  };

  return (
    <>
      <AppShell
        onOpenWallet={() => setShowWallet(true)}
        onOpenHistory={() => setShowHistory(true)}
        onOpenMenu={() => setShowLeaderboard(true)}
      >
        {renderGame()}
      </AppShell>

      {showWallet && <WalletSheet onClose={() => setShowWallet(false)} />}
      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
      {showLeaderboard && <Leaderboard onClose={() => setShowLeaderboard(false)} />}
      <FairnessDrawer open={fairnessOpen} onClose={() => setFairnessOpen(false)} />

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

      {/* balance used by hidden re-render trigger; silence unused warn in prod */}
      <span style={{ display: "none" }}>{balance.toString()}</span>
    </>
  );
}
