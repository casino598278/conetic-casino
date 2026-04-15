import { useEffect, useState } from "react";
import { ArenaCanvas } from "./arena/ArenaCanvas";
import { BetBar } from "./ui/BetBar";
import { PlayersList } from "./ui/PlayersList";
import { WalletSheet } from "./ui/WalletSheet";
import { FairnessModal } from "./ui/FairnessModal";
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
  const [showFair, setShowFair] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
        sock.on(SERVER_EVENTS.LobbyState, (s: LobbySnapshot) => setSnapshot(s));
        sock.on(SERVER_EVENTS.PlayerJoined, (e: { snapshot: LobbySnapshot }) => setSnapshot(e.snapshot));
        sock.on(SERVER_EVENTS.RoundCommit, (_e) => clearLive());
        sock.on(SERVER_EVENTS.RoundLive, (e: { trajectorySeedHex: string; startedAt: number }) =>
          setLive(e.trajectorySeedHex, e.startedAt),
        );
        sock.on(SERVER_EVENTS.RoundResult, async (r: RoundResult) => {
          setResult(r);
          // Refresh balance after each round (simpler than diffing ledger client-side).
          const me2 = await api<{ balanceNano: string }>("/me");
          setBalance(BigInt(me2.balanceNano));
        });
      } catch (err: any) {
        setAuthError(err.message ?? "auth failed");
      }
    })();
  }, []);

  const countdown = useCountdown(snapshot?.countdownEndsAt ?? null);
  const isLive = !!liveSeed && snapshot?.phase === "LIVE";
  const phase = snapshot?.phase ?? "IDLE";
  const canBet = phase === "COUNTDOWN";
  const pot = snapshot?.potNano ?? "0";

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

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
        <h1>🎰 Conetic Casino</h1>
        <button
          className="balance-pill"
          onClick={() => setShowWallet(true)}
          style={{ background: "var(--panel)" }}
        >
          💎 {fmtTon(balance.toString())} TON
        </button>
      </header>

      <div className="pot-row">
        <div>Pot <strong>{fmtTon(pot)}</strong> TON</div>
        <div>
          {isLive ? (
            <span className="live">● LIVE</span>
          ) : phase === "COUNTDOWN" ? (
            <span className="countdown">Starts in {countdown}</span>
          ) : phase === "RESOLVED" ? (
            <span className="live">Winner!</span>
          ) : (
            <span className="countdown">Waiting…</span>
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

      <BetBar
        disabled={!canBet}
        onPlaced={async () => {
          const me = await api<{ balanceNano: string }>("/me");
          setBalance(BigInt(me.balanceNano));
        }}
        onError={(m) => showToast(m)}
      />

      <div className="tabs">
        <button className="active">Arena</button>
        <button onClick={() => setShowWallet(true)}>Wallet</button>
        <button onClick={() => setShowFair(true)}>Verify</button>
      </div>

      {showWallet && <WalletSheet onClose={() => setShowWallet(false)} />}
      {showFair && (
        <FairnessModal
          initial={
            lastResult && snapshot
              ? {
                  serverSeedHex: lastResult.serverSeedHex,
                  serverSeedHash: lastResult.serverSeedHash,
                  clientSeedsHex: lastResult.clientSeedsHex,
                  roundId: lastResult.roundId,
                  potNano: snapshot.potNano,
                  players: snapshot.players.map((p) => ({ userId: p.userId, stakeNano: p.stakeNano })),
                }
              : undefined
          }
          onClose={() => setShowFair(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
