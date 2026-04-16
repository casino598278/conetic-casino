import { useEffect, useMemo, useState } from "react";
import {
  MINING,
  deriveMiningSeed,
  simulateMining,
  type MiningSnapshot,
  type MiningResultEvent,
} from "@conetic/shared";
import { api } from "../net/api";
import { haptic, notify } from "../telegram/initWebApp";
import { useWalletStore } from "../state/walletStore";
import { colorForUser } from "../arena/colors";

const NANO = 1_000_000_000n;
function fmtTon(s: string): string {
  const n = BigInt(s);
  const w = n / NANO;
  const f = (n % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

function tonToNano(ton: number): bigint {
  if (!Number.isFinite(ton) || ton <= 0) return 0n;
  const s = ton.toFixed(9);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * NANO + BigInt(frac.padEnd(9, "0").slice(0, 9));
}

function randomClientSeed(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

const PRESETS = [1, 5, 10, 100];

interface Props {
  snapshot: MiningSnapshot | null;
  trajectorySeed: string | null;
  liveStartedAt: number | null;
  result: MiningResultEvent | null;
  currentUserId: string | null;
  onError?: (msg: string) => void;
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

export function MiningGame({ snapshot, trajectorySeed, liveStartedAt, result, currentUserId, onError }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const [busy, setBusy] = useState(false);

  const phase = snapshot?.phase ?? "WAITING";
  const players = snapshot?.players ?? [];
  const pot = snapshot?.potNano ?? "0";
  const countdown = useCountdown(snapshot?.countdownEndsAt ?? null);

  // Live gem counts (animated during LIVE phase, snapped to result on RESOLVED)
  const [liveGems, setLiveGems] = useState<number[]>([]);
  const [maxGems, setMaxGems] = useState(20);

  // Pre-compute the full trajectory once we have the seed
  const traj = useMemo(() => {
    if (!trajectorySeed || !snapshot || snapshot.players.length === 0) return null;
    const sortedPlayers = [...snapshot.players].sort((a, b) => (a.userId < b.userId ? -1 : 1));
    return { sortedPlayers, seed: trajectorySeed };
  }, [trajectorySeed, snapshot]);

  // Run animation
  useEffect(() => {
    if (!traj || liveStartedAt == null) return;
    let cancelled = false;
    let raf = 0;

    (async () => {
      const playerSeeds = await Promise.all(
        traj.sortedPlayers.map((p, i) => deriveMiningSeed(traj.seed, p.clientSeedHex, i)),
      );
      if (cancelled) return;
      const totalNano = traj.sortedPlayers.reduce((s, p) => s + BigInt(p.stakeNano), 0n);
      const stakeFractions = traj.sortedPlayers.map(
        (p) => Number(BigInt(p.stakeNano) * 1_000_000n / totalNano) / 1_000_000,
      );
      const sim = simulateMining(playerSeeds, stakeFractions);
      const totalDur = sim.durationMs;
      const maxFinal = Math.max(...sim.finalGems, 5);
      setMaxGems(maxFinal);
      setLiveGems(new Array(traj.sortedPlayers.length).fill(0));

      const start = performance.now();
      const tick = () => {
        if (cancelled) return;
        const elapsed = performance.now() - start;
        if (elapsed >= totalDur) {
          setLiveGems(sim.finalGems);
          return;
        }
        const idx = Math.min(sim.steps.length - 1, Math.floor(elapsed / MINING.TICK_MS));
        setLiveGems(sim.steps[idx]!.gems);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [traj, liveStartedAt]);

  // On result, snap final values from server
  useEffect(() => {
    if (!result) return;
    const sortedIds = [...players].map((p) => p.userId).sort();
    const gemsByIdx = result.finalGems.map((g, _i) => {
      const idx = sortedIds.indexOf(g.userId);
      return { idx, gems: g.gems };
    });
    const arr = new Array(sortedIds.length).fill(0);
    for (const g of gemsByIdx) if (g.idx >= 0) arr[g.idx] = g.gems;
    setLiveGems(arr);
    setMaxGems(Math.max(...arr, 5));
    if (result.winnerUserId === currentUserId) notify("success");
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  const stake = async (amountNano: bigint) => {
    if (busy) return;
    if (amountNano <= 0n) { onError?.("invalid amount"); return; }
    if (amountNano > balance) { onError?.("insufficient balance"); notify("error"); return; }
    setBusy(true);
    haptic("medium");
    try {
      await api("/mining/bet", {
        method: "POST",
        body: JSON.stringify({ amountNano: amountNano.toString(), clientSeedHex: randomClientSeed() }),
      });
      notify("success");
    } catch (err: any) {
      notify("error");
      const msg: string = err?.message ?? "failed";
      onError?.(msg.includes("phase_closed") ? "betting closed" : msg.includes("insufficient") ? "insufficient balance" : msg.slice(0, 60));
    } finally {
      setBusy(false);
    }
  };

  const sortedPlayers = useMemo(() => [...players].sort((a, b) => (a.userId < b.userId ? -1 : 1)), [players]);
  const isLive = !!trajectorySeed || phase === "LIVE";
  const winnerUserId = result?.winnerUserId ?? null;

  return (
    <>
      <div className="pot-row">
        <div>Total <strong>{fmtTon(pot)}</strong></div>
        <div>
          {isLive ? <span className="live">MINING</span>
            : phase === "COUNTDOWN" ? <span className="countdown">Starts in {countdown}</span>
            : phase === "RESOLVED" ? <span className="live">Winner!</span>
            : <span className="waiting">{players.length < 2 ? `Waiting (${players.length}/2)` : "Starting…"}</span>}
        </div>
      </div>

      <div className="mining-arena">
        {sortedPlayers.length === 0 && (
          <div className="empty">Stake to start mining</div>
        )}
        {sortedPlayers.map((p, i) => {
          const gems = liveGems[i] ?? 0;
          const pct = maxGems > 0 ? Math.min(100, (gems / maxGems) * 100) : 0;
          const isWinner = winnerUserId === p.userId && phase === "RESOLVED";
          const color = colorForUser(p.userId);
          return (
            <div className={`mining-row ${isWinner ? "winner" : ""}`} key={p.userId}>
              <div className="mining-row-head">
                <span className="mining-avatar" style={{ background: p.photoUrl ? `url(/api/avatar?url=${encodeURIComponent(p.photoUrl)}) center/cover` : `#${color.toString(16).padStart(6, "0")}` }}>
                  {!p.photoUrl && (p.firstName ?? "?").slice(0, 2).toUpperCase()}
                </span>
                <span className="mining-name">{p.username ? `@${p.username}` : p.firstName}</span>
                <span className="mining-gems">{gems} 💎</span>
              </div>
              <div className="mining-bar">
                <div className="mining-bar-fill" style={{ width: `${pct}%`, background: `#${color.toString(16).padStart(6, "0")}` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="bet-bar">
        {PRESETS.map((p) => {
          const nano = tonToNano(p);
          const tooPoor = nano > balance;
          return (
            <button
              key={p}
              className="bet-preset"
              type="button"
              disabled={busy || tooPoor || isLive || phase === "RESOLVED"}
              onClick={() => stake(nano)}
            >
              {p}
            </button>
          );
        })}
        <button
          className="bet-allin"
          type="button"
          disabled={busy || balance <= 0n || isLive || phase === "RESOLVED"}
          onClick={() => stake(balance)}
        >
          All-in
        </button>
      </div>
    </>
  );
}
