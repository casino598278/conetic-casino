import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  SWASH_GRID_H,
  SWASH_GRID_W,
  SWASH_FREE_SPINS,
  SWASH_BONUS_BUY_COST,
  SWASH_ANTE_MULTIPLIER,
  SWASH_SCATTERS_TO_TRIGGER,
  SWASH_FS_RETRIGGER_SCATTERS,
  SWASH_FS_RETRIGGER_AWARD,
  type SwashSymbol,
  type SwashSpinStep,
  type SwashOutcome,
} from "@conetic/shared";
import { api, ApiError } from "../../net/api";
import { haptic, notify } from "../../telegram/initWebApp";
import { useWalletStore } from "../../state/walletStore";
import { usePriceStore, usdToNano, nanoToUsd, fmtUsd } from "../../state/priceStore";
import { SwashSymbolIcon, SwashBombIcon } from "./swashSymbols";
import { playSwashSound, unlockAudio } from "./swashAudio";

// ────────────────────────── helpers ──────────────────────────

const randomIdleGrid = (): SwashSymbol[][] => {
  const bag: SwashSymbol[] = ["red", "purple", "green", "blue", "plum", "apple", "watermelon", "grape", "banana"];
  return Array.from({ length: SWASH_GRID_H }, () =>
    Array.from({ length: SWASH_GRID_W }, () => bag[Math.floor(Math.random() * bag.length)]!),
  );
};

interface PlayResult {
  ok: true;
  outcome: SwashOutcome;
  multiplier: number;
  betNano: string;
  baseBetNano: string;
  mode: "spin" | "buy";
  ante: boolean;
  payoutNano: string;
  newBalanceNano: string;
}

interface Props {
  onBack: () => void;
  onError?: (msg: string) => void;
}

// ────────────────────────── animation timings ──────────────────────────

const STAGGER_MS = 28;           // per-column drop stagger
const DROP_DUR_MS = 220;         // full drop per column
const WIN_FLASH_MS = 320;        // winning-cluster pulse+burst dwell
const TUMBLE_GAP_MS = 90;        // post-burst pause before next drop
// A no-win drop can advance without the win-flash dwell. We still need the
// whole staggered drop to finish before the next step fires or cells visibly
// overlap. Last column finishes at STAGGER_MS*5 + DROP_DUR_MS; add a small
// breather so the eye can register the grid settled.
const STEP_DUR_WIN = STAGGER_MS * (SWASH_GRID_W - 1) + DROP_DUR_MS + WIN_FLASH_MS + TUMBLE_GAP_MS;
const STEP_DUR_NOWIN = STAGGER_MS * (SWASH_GRID_W - 1) + DROP_DUR_MS + 120;
const stepDuration = (step: SwashSpinStep) => (step.winningCells.length > 0 ? STEP_DUR_WIN : STEP_DUR_NOWIN);

const FS_INTRO_MS = 1100;
const FS_BETWEEN_MS = 220;
const FS_OUTRO_MS = 1300;
const BIG_WIN_MS = 1800;
const COUNTUP_DUR_MS = 900;
const SPIN_WIN_FLASH_MS = 900;      // per-spin "+$X.XX" popup dwell + count-up
const RETRIGGER_FLASH_MS = 1200;    // "+5 FREE SPINS" banner dwell
const NICE_FLASH_MS = 1100;         // "NICE!" mid-tier celebration dwell

// ────────────────────────── component ──────────────────────────

export function SwashBooze({ onBack, onError }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const setBalance = useWalletStore((s) => s.setBalance);
  const usdPerTon = usePriceStore((s) => s.usdPerTon);

  const [bet, setBet] = useState("1");
  const [ante, setAnte] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;
  const snd = (kind: Parameters<typeof playSwashSound>[0]) => playSwashSound(kind, soundOnRef.current);

  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [grid, setGrid] = useState<SwashSymbol[][]>(() => randomIdleGrid());
  const [stepCounter, setStepCounter] = useState(0); // bumps on every grid swap so keys change and React remounts cells
  const [winCells, setWinCells] = useState<Set<string>>(new Set());
  const [bombs, setBombs] = useState<Array<{ row: number; col: number; value: number }>>([]);
  const [scatterCount, setScatterCount] = useState(0);
  const [phase, setPhase] = useState<"idle" | "base" | "fs" | "big-win">("idle");
  const [fsMeta, setFsMeta] = useState<null | { spinsTotal: number; spinIdx: number; fsMult: number; stakeUsd: number }>(null);
  const [bigWin, setBigWin] = useState<null | { tier: WinTier; multiplier: number; stakeUsd: number }>(null);
  const [niceFlash, setNiceFlash] = useState<null | { usd: number }>(null);
  const [showFsIntro, setShowFsIntro] = useState(false);
  const [showFsOutro, setShowFsOutro] = useState<null | { totalMult: number; stakeUsd: number }>(null);
  const [winCounterUsd, setWinCounterUsd] = useState<number | null>(null);
  // Floating per-spin/per-tumble win amount popup over the grid.
  const [spinWinFlash, setSpinWinFlash] = useState<null | { usd: number; kind: "tumble" | "spin" }>(null);
  // Retrigger "+5 SPINS" banner flash.
  const [retriggerFlash, setRetriggerFlash] = useState(false);
  // Tumble-win pill: purple banner above grid showing running tumble total.
  const [tumblePill, setTumblePill] = useState<null | { usd: number; multiplier?: number }>(null);
  // Track ALL outstanding RAFs (count-up for FS running total, count-up for
  // final settle, etc). The previous single-ref version could leak if a new
  // RAF was started while an old one was still ticking.
  const rafsRef = useRef<Set<number>>(new Set());
  const cancelAllRafs = () => {
    for (const id of rafsRef.current) cancelAnimationFrame(id);
    rafsRef.current.clear();
  };
  // Effective stake for the CURRENT round in USD. Set in playOutcome(); read
  // in renderStep() so the per-cluster "PAYS $X" subline shows the true win.
  const stakeUsdRef = useRef<number>(0);
  // Per-cell "generation" counter. Each cell has its own counter; we bump it
  // ONLY when the symbol at that position actually changes. React keys on
  // this generation so unchanged cells don't remount (keeping the memoized
  // SVG and avoiding re-parsing), while fresh symbols get a key flip and
  // replay the drop keyframe.
  const cellGenRef = useRef<number[][]>(
    Array.from({ length: SWASH_GRID_H }, () => Array.from({ length: SWASH_GRID_W }, () => 0)),
  );
  const prevGridRef = useRef<SwashSymbol[][] | null>(null);
  const prevScatterCountRef = useRef<number>(0);
  const [showBuyModal, setShowBuyModal] = useState(false);

  const timers = useRef<number[]>([]);
  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    cancelAllRafs();
  };
  useEffect(() => () => clearTimers(), []);

  // ────────────────────────── server call ──────────────────────────

  const callServer = async (mode: "spin" | "buy"): Promise<PlayResult> => {
    if (usdPerTon == null) throw new Error("price_not_loaded");
    const usd = parseFloat(bet);
    if (!Number.isFinite(usd) || usd <= 0) throw new Error("bad_amount");
    const baseNano = usdToNano(usd, usdPerTon);
    // Pre-flight balance check in USD so we fail fast with a friendly message.
    const effectiveMult = mode === "buy" ? SWASH_BONUS_BUY_COST : ante ? SWASH_ANTE_MULTIPLIER : 1;
    // Use 10_000-scaled integer math to match the server exactly.
    const scaledMult = BigInt(Math.round(effectiveMult * 10_000));
    const effectiveNano = (baseNano * scaledMult) / 10_000n;
    if (effectiveNano > balance) {
      throw new ApiError("", "insufficient_balance", 409);
    }
    const res = await api<PlayResult>("/single/swashbooze/play", {
      method: "POST",
      body: JSON.stringify({
        amountNano: baseNano.toString(),
        mode,
        ante: mode === "buy" ? false : ante,
      }),
    });
    setBalance(BigInt(res.newBalanceNano));
    return res;
  };

  const onSpin = async () => {
    if (busy || rolling || usdPerTon == null) return;
    setBusy(true);
    // Clear the previous round's lingering win counter so the new spin
    // starts visually clean even while the server call is in flight.
    setWinCounterUsd(null);
    unlockAudio();
    snd("spin");
    haptic("light");
    try {
      const r = await callServer("spin");
      playOutcome(r);
    } catch (err) {
      notify("error");
      onError?.(humanize(err));
    } finally {
      setBusy(false);
    }
  };

  const onConfirmBuy = async () => {
    setShowBuyModal(false);
    if (busy || rolling || usdPerTon == null) return;
    setBusy(true);
    setWinCounterUsd(null);
    unlockAudio();
    snd("spin");
    haptic("medium");
    try {
      const r = await callServer("buy");
      playOutcome(r);
    } catch (err) {
      notify("error");
      onError?.(humanize(err));
    } finally {
      setBusy(false);
    }
  };

  const humanize = (err: unknown): string => {
    if (err instanceof ApiError) {
      switch (err.code) {
        case "insufficient_balance": return "Insufficient balance";
        case "rate_limited":         return "Slow down — wait a moment";
        case "ante_disabled_with_buy": return "Turn off Double Chance to buy";
        case "invalid_params":       return "Invalid spin parameters";
        case "unauthenticated":      return "Session expired — reopen the app";
        case "http_502":
        case "http_503":             return "Server is restarting — try again";
        default:                     return `Spin failed (${err.code})`;
      }
    }
    if (err instanceof Error && err.message === "price_not_loaded") return "Loading price…";
    if (err instanceof Error && err.message === "bad_amount") return "Enter a bet amount";
    return "Spin failed. Check your connection.";
  };

  // ────────────────────────── animation driver ──────────────────────────
  //
  // Design: the sequence is built as a flat list of {at, action} pairs, each
  // scheduled with a single setTimeout. No nested timers, no interdependent
  // RAFs firing from inside timers. This makes the timeline easy to read,
  // easy to clearTimers() mid-flight, and impossible to race against itself.
  //
  // t0 is always 0 (spin button press). For each frame of the outcome we
  // compute `at` and push a single action; the driver sorts & schedules at
  // the end.

  const playOutcome = (r: PlayResult) => {
    clearTimers();
    setRolling(true);
    setWinCounterUsd(null);
    setBigWin(null);
    setShowFsIntro(false);
    setShowFsOutro(null);
    setSpinWinFlash(null);
    setRetriggerFlash(false);
    setNiceFlash(null);
    setTumblePill(null);

    // Effective stake for this round — what × multipliers in the outcome
    // apply to. For buy that's 100× bet; for ante 1.25× bet; else 1× bet.
    // All intermediate popups must use THIS, not baseBet, otherwise the
    // in-game numbers are 1/100th of the real win on a buy.
    const stakeUsd = usdPerTon != null ? nanoToUsd(BigInt(r.betNano), usdPerTon) : parseFloat(bet) || 0;
    stakeUsdRef.current = stakeUsd;

    // Force the drop animation to replay on EVERY cell for the initial drop
    // of a new round. Cascades within the round then only animate cells
    // whose symbol changed (see renderStep).
    prevGridRef.current = null;
    prevScatterCountRef.current = 0;

    const scheduled: Array<[number, () => void]> = [];
    const at = (delay: number, fn: () => void) => scheduled.push([delay, fn]);

    let t = 0;

    // ── BASE GAME ──────────────────────────────────────────────────────
    // Each step: schedule a renderStep at t, update tumble pill at t+landed.
    // Losing steps advance in ~370ms, winning steps ~660ms.
    let baseChainUsd = 0;
    const DROP_LAND_MS = STAGGER_MS * (SWASH_GRID_W - 1) + DROP_DUR_MS; // ~360ms
    for (const step of r.outcome.baseSteps) {
      const stepStart = t;
      at(stepStart, () => renderStep(step));
      const stepPayUsd = step.stepMultiplier * stakeUsd;
      if (stepPayUsd > 0) {
        baseChainUsd += stepPayUsd;
        const pillUsd = baseChainUsd;
        at(stepStart + DROP_LAND_MS, () => setTumblePill({ usd: pillUsd }));
      }
      t += stepDuration(step);
    }
    if (baseChainUsd > 0) at(t, () => setTumblePill(null));

    // Base-round popup: only if base paid AND no FS follows (FS has its own).
    const baseUsdWon = (r.outcome.baseClusterMult + r.outcome.baseScatterMult) * stakeUsd;
    if (baseUsdWon > 0 && !r.outcome.freeSpins.triggered) {
      const popAt = t;
      at(popAt, () => setSpinWinFlash({ usd: baseUsdWon, kind: "tumble" }));
      at(popAt + SPIN_WIN_FLASH_MS, () => setSpinWinFlash(null));
      t += SPIN_WIN_FLASH_MS;

      // NICE! celebration — feel-good mid tier (5×–<10× bet, no big-win next).
      const willCelebrate = r.multiplier >= 10;
      if (!willCelebrate && baseUsdWon >= 5 * stakeUsd) {
        const niceAt = t;
        at(niceAt, () => { setNiceFlash({ usd: baseUsdWon }); haptic("medium"); });
        at(niceAt + NICE_FLASH_MS, () => setNiceFlash(null));
        t += NICE_FLASH_MS;
      }
    }

    // ── FREE SPINS ─────────────────────────────────────────────────────
    if (r.outcome.freeSpins.triggered) {
      const introAt = t;
      at(introAt, () => {
        setPhase("fs");
        setShowFsIntro(true);
        setFsMeta({ spinsTotal: SWASH_FREE_SPINS, spinIdx: 0, fsMult: 0, stakeUsd });
        haptic("medium");
        snd("fs-trigger");
      });
      at(introAt + FS_INTRO_MS - 200, () => setShowFsIntro(false));
      t += FS_INTRO_MS;

      let runningMult = 0;
      for (let si = 0; si < r.outcome.freeSpins.spins.length; si++) {
        const fsSpin = r.outcome.freeSpins.spins[si]!;
        const bombMult = Math.max(1, fsSpin.spinMultTotal);
        let spinChainUsd = 0;

        // Render each cascade step of this FS spin.
        for (const step of fsSpin.steps) {
          const stepStart = t;
          at(stepStart, () => renderStep(step));
          const stepPayUsd = step.stepMultiplier * stakeUsd;
          if (stepPayUsd > 0) {
            spinChainUsd += stepPayUsd;
            const pillUsd = spinChainUsd;
            at(stepStart + DROP_LAND_MS, () => setTumblePill({
              usd: pillUsd,
              multiplier: bombMult > 1 ? bombMult : undefined,
            }));
          }
          t += stepDuration(step);
        }
        at(t, () => setTumblePill(null));

        // End of spin: flash "+$X.XX" popup if win, count-up FS total.
        const spinWinUsd = fsSpin.spinWin * stakeUsd;
        const prevRunning = runningMult;
        runningMult += fsSpin.spinWin;
        const idx = si + 1;
        const isRetrigger = fsSpin.initialScatters >= SWASH_FS_RETRIGGER_SCATTERS;

        if (spinWinUsd > 0) {
          const popAt = t;
          const startMult = prevRunning;
          const endMult = runningMult;
          at(popAt, () => {
            setSpinWinFlash({ usd: spinWinUsd, kind: "spin" });
            haptic("light");
            startFsCountUp(startMult, endMult);
          });
          at(popAt + SPIN_WIN_FLASH_MS, () => setSpinWinFlash(null));
          t += SPIN_WIN_FLASH_MS;
        } else {
          // Lock counter to true value even on losing spins.
          at(t, () => setFsMeta((prev) => prev ? { ...prev, fsMult: runningMult } : prev));
        }

        // Retrigger banner (overlays, doesn't block long).
        if (isRetrigger) {
          const retrigAt = t;
          at(retrigAt, () => {
            setRetriggerFlash(true);
            haptic("medium");
            setFsMeta((prev) => prev ? { ...prev, spinsTotal: prev.spinsTotal + SWASH_FS_RETRIGGER_AWARD } : prev);
          });
          at(retrigAt + RETRIGGER_FLASH_MS, () => setRetriggerFlash(false));
          t += 400; // short beat — banner overlaps next spin's drop
        }

        // Advance spin index.
        at(t, () => setFsMeta((prev) => prev ? { ...prev, spinIdx: idx } : prev));
        t += FS_BETWEEN_MS;
      }

      // FS outro.
      const outroAt = t;
      at(outroAt, () => {
        setShowFsOutro({ totalMult: r.outcome.freeSpins.fsMultiplier, stakeUsd });
        haptic("heavy");
      });
      at(outroAt + FS_OUTRO_MS - 200, () => setShowFsOutro(null));
      t += FS_OUTRO_MS;
    }

    // ── BIG WIN CELEBRATION ────────────────────────────────────────────
    const tier = bigWinTier(r.multiplier);
    if (tier) {
      const bwAt = t;
      at(bwAt, () => {
        setPhase("big-win");
        setBigWin({ tier, multiplier: r.multiplier, stakeUsd });
        haptic("heavy");
        snd("bigwin");
      });
      at(bwAt + BIG_WIN_MS, () => {
        setBigWin(null);
        setPhase("idle");
      });
      t += BIG_WIN_MS;
    }

    // ── FINAL SETTLE ───────────────────────────────────────────────────
    at(t, () => {
      setRolling(false);
      setWinCells(new Set());
      setScatterCount(0);
      setPhase("idle");
      setFsMeta(null);
      setBombs([]);
      setTumblePill(null);
      if (r.multiplier > 0 && usdPerTon != null) {
        const usd = nanoToUsd(BigInt(r.payoutNano), usdPerTon);
        animateCountUp(usd);
      } else {
        setWinCounterUsd(null);
      }
    });

    // Flush all scheduled actions into real setTimeout calls.
    for (const [delay, fn] of scheduled) {
      timers.current.push(window.setTimeout(fn, delay));
    }
  };

  // Count the FS running-total pill from startMult → endMult over one
  // SPIN_WIN_FLASH_MS window. Cancels any in-flight count-up first so we
  // can't race two tickers.
  const startFsCountUp = (startMult: number, endMult: number) => {
    cancelAllRafs();
    const started = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / SPIN_WIN_FLASH_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      const cur = startMult + (endMult - startMult) * eased;
      setFsMeta((prev) => prev ? { ...prev, fsMult: cur } : prev);
      if (p < 1) {
        const nextId = requestAnimationFrame(tick);
        rafsRef.current.add(nextId);
      }
    };
    const id = requestAnimationFrame(tick);
    rafsRef.current.add(id);
  };

  const renderStep = (step: SwashSpinStep) => {
    // Bump per-cell generation only for cells whose SYMBOL changed between
    // the previous grid and this one. This way unchanged cells keep the
    // same React key (no remount, no SVG re-parse) while new arrivals get
    // a fresh key and replay the drop keyframe.
    const prev = prevGridRef.current;
    const gen = cellGenRef.current;
    for (let r = 0; r < SWASH_GRID_H; r++) {
      const prevRow = prev?.[r];
      const curRow = step.grid[r]!;
      const genRow = gen[r]!;
      for (let c = 0; c < SWASH_GRID_W; c++) {
        if (!prevRow || prevRow[c] !== curRow[c]) {
          genRow[c]!++;
        }
      }
    }
    prevGridRef.current = step.grid;

    setGrid(step.grid);
    setBombs(step.bombs);
    setScatterCount(step.scatterCount);
    const ws = new Set<string>();
    for (const c of step.winningCells) ws.add(`${c.row},${c.col}`);
    setWinCells(ws);
    // Bump stepCounter so React re-renders the grid (cellGen is a ref, not state).
    setStepCounter((n) => n + 1);
    // Soft drop thud for every new grid (every step).
    snd("drop");
    if (step.winningCells.length > 0) {
      // Haptic only fires on CLUSTER wins — drops alone don't buzz the device.
      haptic("light");
      snd("win");
    }
    if (step.bombs.length > 0) snd("bomb");
    // Scatter ding — only when count increases (new scatter landed).
    if (step.scatterCount > prevScatterCountRef.current) snd("scatter");
    prevScatterCountRef.current = step.scatterCount;
  };

  const animateCountUp = (targetUsd: number) => {
    // Cancel any in-flight tickers before starting a new one.
    cancelAllRafs();
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / COUNTUP_DUR_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      setWinCounterUsd(targetUsd * eased);
      if (p < 1) {
        const nextId = requestAnimationFrame(step);
        rafsRef.current.add(nextId);
      }
    };
    const id = requestAnimationFrame(step);
    rafsRef.current.add(id);
  };

  // ────────────────────────── bet controls ──────────────────────────

  const balUsd = usdPerTon != null ? nanoToUsd(balance, usdPerTon) : 0;
  const betUsd = parseFloat(bet) || 0;
  const buyCostUsd = betUsd * SWASH_BONUS_BUY_COST;
  const effectiveBetUsd = betUsd * (ante ? SWASH_ANTE_MULTIPLIER : 1);

  // O(1) bomb lookup by cell position (rebuilt when bombs state changes).
  const bombsByPos = useMemo(() => {
    const m = new Map<string, { row: number; col: number; value: number }>();
    for (const b of bombs) m.set(`${b.row},${b.col}`, b);
    return m;
  }, [bombs]);

  // One canonical "is any modal/banner currently covering the grid" flag.
  // Used to suppress redundant banners instead of repeating the same long
  // condition in five places.
  const anyOverlay = !!(bigWin || niceFlash || showFsIntro || showFsOutro);

  const BET_STEPS = [0.20, 0.40, 0.80, 1.00, 2.00, 5.00, 10.00, 20.00, 50.00, 100.00];
  const currentStep = BET_STEPS.findIndex((v) => v >= betUsd);
  const decBet = () => {
    const idx = currentStep <= 0 ? 0 : currentStep - 1;
    setBet(BET_STEPS[idx]!.toFixed(2));
    snd("click");
  };
  const incBet = () => {
    const idx = currentStep < 0 ? BET_STEPS.length - 1 : Math.min(currentStep + 1, BET_STEPS.length - 1);
    setBet(BET_STEPS[idx]!.toFixed(2));
    snd("click");
  };

  // ────────────────────────── render ──────────────────────────

  return (
    <div className="sg-screen swash-screen">
      {/* Header */}
      <div className="swash-head">
        <button className="swash-head-back" onClick={onBack} type="button" aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="swash-head-title">Swash Booze</div>
        <button
          type="button"
          className="swash-head-sound"
          onClick={() => {
            unlockAudio();
            setSoundOn((s) => {
              const next = !s;
              if (next) playSwashSound("click", true);
              return next;
            });
          }}
          aria-label={soundOn ? "Mute" : "Unmute"}
        >
          {soundOn ? "🔊" : "🔇"}
        </button>
      </div>

      {/* Candy-world stage */}
      <div className={`swash-stage ${phase === "fs" ? "is-fs" : ""}`}>
        <div className="swash-cloud swash-cloud-1" aria-hidden />
        <div className="swash-cloud swash-cloud-2" aria-hidden />
        <div className="swash-cloud swash-cloud-3" aria-hidden />

        {/* Top banner slot: in-flow, fixed height, mutually exclusive
            content. Never overlaps the grid because it sits above it in
            the flex column. */}
        <div className="swash-top-banner-slot" aria-hidden>
          {phase !== "fs" && !anyOverlay && (
            !rolling
              ? <div className="swash-marquee">WIN OVER 21,100× BET</div>
              : <div className="swash-top-banner">★ SYMBOLS PAY ANYWHERE ON THE SCREEN ★</div>
          )}
        </div>

        {/* Grid area — full width on mobile, centered.
            Stable outer keys (r,c) let React diff the grid without tearing
            everything down every step — only the inner "animation slot" is
            keyed to stepCounter so the drop keyframe replays exactly where
            needed. Memoized SwashSymbolIcon then skips SVG re-render if the
            symbol and winning-state didn't actually change. */}
        <div className="swash-grid-frame">
          <div className="swash-grid">
            {grid.map((row, r) => row.map((sym, c) => {
              const posKey = `${r},${c}`;
              const isWin = winCells.has(posKey);
              const bomb = bombsByPos.get(posKey);
              const innerKey = `${cellGenRef.current[r]![c]}-${posKey}`;
              return (
                <div
                  key={posKey}
                  className={`swash-cell ${isWin ? "is-win" : ""}`}
                >
                  <div
                    key={innerKey}
                    className="swash-cell-inner"
                    style={{ animationDelay: `${c * STAGGER_MS}ms` }}
                  >
                    {bomb ? (
                      <SwashBombIcon value={bomb.value} winning={isWin} />
                    ) : (
                      <SwashSymbolIcon symbol={sym} winning={isWin} />
                    )}
                  </div>
                  {isWin && <div className="swash-cell-burst" aria-hidden />}
                </div>
              );
            }))}
          </div>

          {/* Scatter counter — show while rolling too so player sees the build-up */}
          {phase !== "fs" && scatterCount > 0 && scatterCount < SWASH_SCATTERS_TO_TRIGGER && (
            <div className="swash-scatter-counter">
              {scatterCount}/{SWASH_SCATTERS_TO_TRIGGER}
            </div>
          )}

          {/* FS intro — dark purple polka-dot panel with splat-framed number */}
          {showFsIntro && (
            <div className="swash-fs-intro">
              <div className="swash-fs-intro-top">CONGRATULATIONS</div>
              <div className="swash-fs-intro-sub">YOU HAVE WON</div>
              <div className="swash-fs-intro-splat">
                <div className="swash-fs-intro-big">{SWASH_FREE_SPINS}</div>
              </div>
              <div className="swash-fs-intro-bottom">FREE SPINS</div>
              <div className="swash-fs-intro-hint">PRESS ANYWHERE TO CONTINUE</div>
            </div>
          )}

          {/* FS outro — same dark panel, shows total feature win */}
          {showFsOutro && (
            <div className="swash-fs-intro">
              <div className="swash-fs-intro-top">CONGRATULATIONS</div>
              <div className="swash-fs-intro-sub">YOU HAVE WON</div>
              <div className="swash-fs-intro-splat">
                <div className="swash-fs-intro-big">{fmtUsd(showFsOutro.totalMult * showFsOutro.stakeUsd)}</div>
              </div>
              <div className="swash-fs-intro-bottom">IN {SWASH_FREE_SPINS} FREE SPINS</div>
              <div className="swash-fs-intro-hint">PRESS ANYWHERE TO CONTINUE</div>
            </div>
          )}

          {/* Big Win */}
          {bigWin && (
            <div className={`swash-big-win is-${bigWin.tier}`}>
              <div className="swash-big-win-label">{WIN_TIER_LABEL[bigWin.tier]}</div>
              <div className="swash-big-win-amount">{fmtUsd(bigWin.multiplier * bigWin.stakeUsd)}</div>
              {bigWin.tier === "legendary" && <div className="swash-legendary-confetti" aria-hidden />}
            </div>
          )}

          {/* NICE! mid-win celebration — smaller than BIG WIN, more frequent */}
          {niceFlash && !bigWin && (
            <div className="swash-nice-banner">
              <div className="swash-nice-banner-text">NICE!</div>
              <div className="swash-nice-banner-amount">{fmtUsd(niceFlash.usd)}</div>
            </div>
          )}

          {/* Settle win counter — just the total. Per-cluster breakdown was
              dropped because it mixed raw paytable multipliers with stake
              and looked wrong on FS rounds. */}
          {winCounterUsd != null && phase === "idle" && !bigWin && (
            <div className="swash-win-counter">WIN {fmtUsd(winCounterUsd)}</div>
          )}

          {/* FREE SPINS LEFT N sub-readout during FS (hide once all spins are consumed so we don't show "LEFT 0") */}
          {phase === "fs" && fsMeta && !showFsIntro && !showFsOutro && fsMeta.spinsTotal - fsMeta.spinIdx > 0 && (
            <div className="swash-fs-remaining">
              <div className="swash-fs-remaining-win">WIN {fmtUsd(fsMeta.fsMult * fsMeta.stakeUsd)}</div>
              <div className="swash-fs-remaining-count">FREE SPINS LEFT {fsMeta.spinsTotal - fsMeta.spinIdx}</div>
            </div>
          )}

          {/* Tumble-win pill above the grid */}
          {tumblePill && (
            <div className="swash-tumble-pill">
              <div className="swash-tumble-pill-label">TUMBLE WIN</div>
              <div className="swash-tumble-pill-amount">
                {fmtUsd(tumblePill.usd)}
                {tumblePill.multiplier ? <span className="swash-tumble-pill-mult"> × {tumblePill.multiplier}</span> : null}
              </div>
            </div>
          )}

          {/* Per-spin/per-tumble win popup — floats over the grid and fades. */}
          {spinWinFlash && !bigWin && (
            <div
              className={`swash-spin-win is-${spinWinFlash.kind}`}
              key={`${spinWinFlash.usd}-${spinWinFlash.kind}-${stepCounter}`}
            >
              <div className="swash-spin-win-amount">+{fmtUsd(spinWinFlash.usd)}</div>
            </div>
          )}

          {/* Retrigger banner — "+5 FREE SPINS" during FS when 3+ scatters land. */}
          {retriggerFlash && (
            <div className="swash-retrigger">+{SWASH_FS_RETRIGGER_AWARD} FREE SPINS</div>
          )}
        </div>

        {/* Feature buttons — horizontal row below the grid on mobile */}
        <div className="swash-feature-row">
          <button
            type="button"
            className="swash-feature-buy"
            onClick={() => {
              if (ante) { onError?.("Turn off Double Chance to buy"); return; }
              if (busy || rolling) return;
              unlockAudio();
              snd("click");
              setShowBuyModal(true);
            }}
            disabled={busy || rolling}
          >
            <span className="swash-feature-buy-label">BUY FEATURE</span>
            <span className="swash-feature-buy-price">{fmtUsd(buyCostUsd)}</span>
          </button>

          {/* Merged bet card: BET amount + Double Chance toggle in one green candy card */}
          <div className={`swash-bet-card ${ante ? "is-ante-on" : ""}`}>
            <div className="swash-bet-card-amount">
              <span className="swash-bet-card-label">BET</span>
              <span className="swash-bet-card-value">{fmtUsd(effectiveBetUsd)}</span>
            </div>
            <button
              type="button"
              className="swash-bet-card-ante"
              onClick={() => { setAnte((a) => !a); snd("click"); }}
              disabled={busy || rolling}
              aria-pressed={ante}
            >
              <div className="swash-bet-card-ante-copy">
                <span className="swash-bet-card-ante-title">DOUBLE CHANCE</span>
                <span className="swash-bet-card-ante-sub">TO WIN FEATURE</span>
              </div>
              <div className={`swash-bet-card-ante-toggle ${ante ? "is-on" : ""}`}>
                <span className="swash-bet-card-ante-thumb" />
                <span className="swash-bet-card-ante-state">{ante ? "ON" : "OFF"}</span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom HUD */}
      <div className="swash-hud">
        <div className="swash-hud-readout">
          <div className="swash-hud-row">
            <span className="swash-hud-lbl">CREDIT</span>
            <span className="swash-hud-val">{fmtUsd(balUsd)}</span>
          </div>
        </div>

        <div className="swash-hud-ctrls">
          <button
            type="button"
            className="swash-bet-btn"
            onClick={decBet}
            disabled={busy || rolling}
            aria-label="Decrease bet"
          >−</button>

          <button
            type="button"
            className={`swash-spin-btn ${busy || rolling ? "is-spinning" : ""}`}
            onClick={onSpin}
            disabled={busy || rolling}
            aria-label="Spin"
          >
            <svg viewBox="0 0 100 100" width="72" height="72">
              <circle cx="50" cy="50" r="46" fill="#ffd54a" stroke="#b6730b" strokeWidth="3" />
              <circle cx="50" cy="50" r="36" fill="#ff8f1f" />
              <path
                d="M50 22 A 28 28 0 0 1 78 50 L 70 50 L 82 62 L 94 50 L 86 50 A 36 36 0 0 0 50 14 Z"
                fill="#ffffff"
              />
              <path
                d="M50 78 A 28 28 0 0 1 22 50 L 30 50 L 18 38 L 6 50 L 14 50 A 36 36 0 0 0 50 86 Z"
                fill="#ffffff"
              />
            </svg>
          </button>

          <button
            type="button"
            className="swash-bet-btn"
            onClick={incBet}
            disabled={busy || rolling}
            aria-label="Increase bet"
          >+</button>
        </div>
      </div>

      {/* Buy confirmation modal — portaled to body so any transformed
          ancestor of .swash-screen doesn't break position:fixed centering. */}
      {showBuyModal && createPortal(
        <div className="swash-buy-modal-bg" onClick={() => setShowBuyModal(false)}>
          <div className="swash-buy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="swash-buy-modal-title">ARE YOU SURE YOU WANT TO PURCHASE</div>
            <div className="swash-buy-modal-deal">
              <span className="swash-buy-modal-deal-num">{SWASH_FREE_SPINS}</span>
              <span className="swash-buy-modal-deal-txt">FREE SPINS</span>
            </div>
            <div className="swash-buy-modal-cost-line">
              AT THE COST OF <span className="swash-buy-modal-cost-price">{fmtUsd(buyCostUsd)}</span>?
            </div>
            <div className="swash-buy-modal-actions">
              <button
                type="button"
                className="swash-buy-modal-confirm"
                onClick={onConfirmBuy}
                disabled={buyCostUsd > balUsd}
              >
                {buyCostUsd > balUsd ? "LOW BAL" : "YES"}
              </button>
              <button
                type="button"
                className="swash-buy-modal-cancel"
                onClick={() => setShowBuyModal(false)}
              >
                NO
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

type WinTier = "big" | "mega" | "epic" | "sensational" | "legendary";

function bigWinTier(multiplier: number): WinTier | null {
  if (multiplier >= 500) return "legendary";
  if (multiplier >= 100) return "sensational";
  if (multiplier >= 50) return "epic";
  if (multiplier >= 25) return "mega";
  if (multiplier >= 10) return "big";
  return null;
}

const WIN_TIER_LABEL: Record<WinTier, string> = {
  big: "BIG WIN",
  mega: "MEGA WIN",
  epic: "EPIC WIN",
  sensational: "SENSATIONAL WIN",
  legendary: "LEGENDARY WIN",
};
