import { useEffect, useMemo, useRef, useState } from "react";
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const avatarImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const phase = snapshot?.phase ?? "WAITING";
  const players = snapshot?.players ?? [];
  const pot = snapshot?.potNano ?? "0";
  const countdown = useCountdown(snapshot?.countdownEndsAt ?? null);

  const [liveGems, setLiveGems] = useState<number[]>([]);
  const sortedPlayers = useMemo(() => [...players].sort((a, b) => (a.userId < b.userId ? -1 : 1)), [players]);

  // Preload avatar images
  useEffect(() => {
    for (const p of sortedPlayers) {
      if (p.photoUrl && !avatarImagesRef.current.has(p.userId)) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = `/api/avatar?url=${encodeURIComponent(p.photoUrl)}`;
        avatarImagesRef.current.set(p.userId, img);
      }
    }
  }, [sortedPlayers]);

  // Run the animation
  useEffect(() => {
    if (!trajectorySeed || liveStartedAt == null || sortedPlayers.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let rafId = 0;

    (async () => {
      const playerSeeds = await Promise.all(
        sortedPlayers.map((p, i) => deriveMiningSeed(trajectorySeed, p.clientSeedHex, i)),
      );
      if (cancelled) return;
      const totalNano = sortedPlayers.reduce((s, p) => s + BigInt(p.stakeNano), 0n);
      const stakeFractions = sortedPlayers.map(
        (p) => Number(BigInt(p.stakeNano) * 1_000_000n / totalNano) / 1_000_000,
      );
      const sim = simulateMining(playerSeeds, stakeFractions, trajectorySeed);
      setLiveGems(new Array(sortedPlayers.length).fill(0));

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const cellSize = Math.min(w, h) / MINING.GRID_SIZE;
      const gridPx = cellSize * MINING.GRID_SIZE;
      const offX = (w - gridPx) / 2;
      const offY = (h - gridPx) / 2;

      const start = performance.now();

      // Interpolate between frames for smooth movement
      const render = (frameIdx: number, frameProgress: number) => {
        ctx.clearRect(0, 0, w, h);
        // Background
        ctx.fillStyle = "#161616";
        ctx.fillRect(0, 0, w, h);
        // Grid
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.lineWidth = 1;
        for (let i = 0; i <= MINING.GRID_SIZE; i++) {
          ctx.beginPath();
          ctx.moveTo(offX + i * cellSize, offY);
          ctx.lineTo(offX + i * cellSize, offY + gridPx);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(offX, offY + i * cellSize);
          ctx.lineTo(offX + gridPx, offY + i * cellSize);
          ctx.stroke();
        }

        const frame = sim.frames[frameIdx];
        if (!frame) return;
        const prevFrame = frameIdx > 0 ? sim.frames[frameIdx - 1] : frame;

        // Draw gems
        for (const g of frame.gems) {
          const cx = offX + (g.x + 0.5) * cellSize;
          const cy = offY + (g.y + 0.5) * cellSize;
          // Gem shape (diamond)
          ctx.save();
          ctx.translate(cx, cy);
          const r = cellSize * 0.35;
          ctx.fillStyle = "#f5c14b";
          ctx.strokeStyle = "#ffd76e";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, -r);
          ctx.lineTo(r * 0.7, 0);
          ctx.lineTo(0, r);
          ctx.lineTo(-r * 0.7, 0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }

        // Draw players (interpolated between prevFrame and frame)
        for (let i = 0; i < frame.players.length; i++) {
          const p = frame.players[i]!;
          const prev = prevFrame!.players[i]!;
          const ix = prev.x + (p.x - prev.x) * frameProgress;
          const iy = prev.y + (p.y - prev.y) * frameProgress;
          const cx = offX + (ix + 0.5) * cellSize;
          const cy = offY + (iy + 0.5) * cellSize;
          const player = sortedPlayers[i]!;
          const colour = colorForUser(player.userId);
          const radius = cellSize * 0.5;

          // Outer ring in player colour
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fillStyle = `#${colour.toString(16).padStart(6, "0")}`;
          ctx.fill();

          // Avatar image (if loaded) clipped to inner circle, else initials
          const img = avatarImagesRef.current.get(player.userId);
          if (img && img.complete && img.naturalWidth > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, cx - radius + 2, cy - radius + 2, (radius - 2) * 2, (radius - 2) * 2);
            ctx.restore();
          } else {
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
            ctx.fill();
            const initials = (player.firstName ?? "?").slice(0, 2).toUpperCase();
            ctx.fillStyle = `#${colour.toString(16).padStart(6, "0")}`;
            ctx.font = `bold ${Math.floor(cellSize * 0.5)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(initials, cx, cy);
          }
        }
      };

      const animate = () => {
        if (cancelled) return;
        const elapsed = performance.now() - start;
        const totalDur = sim.durationMs;
        if (elapsed >= totalDur) {
          render(sim.frames.length - 1, 1);
          setLiveGems(sim.finalGems);
          return;
        }
        const frameFloat = elapsed / MINING.TICK_MS;
        const frameIdx = Math.min(sim.frames.length - 1, Math.floor(frameFloat));
        const frameProgress = frameFloat - frameIdx;
        render(frameIdx, frameProgress);
        // Update gem counts
        const f = sim.frames[frameIdx];
        if (f) setLiveGems(f.players.map((p) => p.gems));
        rafId = requestAnimationFrame(animate);
      };
      rafId = requestAnimationFrame(animate);
    })();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [trajectorySeed, liveStartedAt, sortedPlayers]);

  // When result arrives, snap final gem counts
  useEffect(() => {
    if (!result) return;
    const sortedIds = sortedPlayers.map((p) => p.userId);
    const arr = new Array(sortedIds.length).fill(0);
    for (const g of result.finalGems) {
      const idx = sortedIds.indexOf(g.userId);
      if (idx >= 0) arr[idx] = g.gems;
    }
    setLiveGems(arr);
    if (result.winnerUserId === currentUserId) notify("success");
  }, [result, currentUserId, sortedPlayers]);

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

  const isLive = !!trajectorySeed || phase === "LIVE";
  const winnerUserId = result?.winnerUserId ?? null;
  const totalNano = sortedPlayers.reduce((s, p) => s + BigInt(p.stakeNano), 0n);

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

      <div className="mining-arena-wrap" style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={400}
          height={400}
          className="mining-canvas"
        />
        {!isLive && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            color: "var(--t3)", fontSize: 14, fontWeight: 600,
            pointerEvents: "none",
          }}>
            {phase === "COUNTDOWN" ? `Mining starts in ${countdown}` : "Waiting for players…"}
          </div>
        )}
      </div>

      <div className="mining-player-list">
        {sortedPlayers.length === 0 && <div className="empty">Stake to start mining</div>}
        {sortedPlayers.map((p, i) => {
          const gems = liveGems[i] ?? 0;
          const isWinner = winnerUserId === p.userId && phase === "RESOLVED";
          const color = colorForUser(p.userId);
          const pct = totalNano > 0n ? Number(BigInt(p.stakeNano) * 10000n / totalNano) / 100 : 0;
          return (
            <div className={`mining-pl ${isWinner ? "winner" : ""}`} key={p.userId}>
              <span className="mining-pl-avatar" style={{ background: p.photoUrl ? `url(/api/avatar?url=${encodeURIComponent(p.photoUrl)}) center/cover` : `#${color.toString(16).padStart(6, "0")}` }}>
                {!p.photoUrl && (p.firstName ?? "?").slice(0, 2).toUpperCase()}
              </span>
              <span className="mining-pl-name">{p.username ? `@${p.username}` : p.firstName}</span>
              <span className="mining-pl-pct">{pct.toFixed(1)}%</span>
              <span className="mining-pl-gems">{gems} 💎</span>
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
