import { useEffect, useRef, useState } from "react";
import {
  DICE_MIN_TARGET,
  DICE_MAX_TARGET,
  diceMultiplier,
  diceWinChance,
} from "@conetic/shared";
import { api, ApiError } from "../../net/api";
import { haptic, notify } from "../../telegram/initWebApp";
import { useWalletStore } from "../../state/walletStore";

const NANO = 1_000_000_000n;

function fmtTon(nano: bigint): string {
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}
function tonToNano(ton: number): bigint {
  if (!Number.isFinite(ton) || ton <= 0) return 0n;
  const s = ton.toFixed(9);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * NANO + BigInt(frac.padEnd(9, "0").slice(0, 9));
}

interface PlayResult {
  ok: true;
  outcome: { roll: number; win: boolean };
  multiplier: number;
  winChance: number;
  betNano: string;
  payoutNano: string;
  newBalanceNano: string;
  nonce: number;
  playId: number;
}

interface Props {
  onBack: () => void;
  onError?: (msg: string) => void;
  onOpenFairness: () => void;
}

export function Dice({ onBack, onError, onOpenFairness }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const setBalance = useWalletStore((s) => s.setBalance);

  const [target, setTarget] = useState(50.5);
  const [over, setOver] = useState(true);
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [roll, setRoll] = useState<number | null>(null);
  const [win, setWin] = useState<boolean | null>(null);
  const [lastPayout, setLastPayout] = useState<string | null>(null);
  // Position of the "landing marker" on the track, 0..100. null = hidden.
  const [markerPos, setMarkerPos] = useState<number | null>(null);
  const [markerWin, setMarkerWin] = useState<boolean | null>(null);
  const animRef = useRef<number | null>(null);

  const chance = diceWinChance({ target, over });
  const mult = diceMultiplier({ target, over });
  const profit = (parseFloat(amount) || 0) * (mult - 1);

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  const play = async () => {
    const ton = parseFloat(amount);
    if (!Number.isFinite(ton) || ton <= 0) { onError?.("Enter a bet amount"); return; }
    const nano = tonToNano(ton);
    if (nano > balance) { onError?.("Insufficient balance"); notify("error"); return; }
    if (busy) return;
    setBusy(true);
    haptic("light");
    try {
      const r: PlayResult = await api("/single/dice/play", {
        method: "POST",
        body: JSON.stringify({ amountNano: nano.toString(), target, over }),
      });
      animateRoll(r.outcome.roll, r.outcome.win);
      setLastPayout(r.payoutNano);
      setBalance(BigInt(r.newBalanceNano));
      notify(r.outcome.win ? "success" : "warning");
    } catch (err: unknown) {
      notify("error");
      onError?.(humanizeBetError(err));
    } finally {
      setBusy(false);
    }
  };

  function humanizeBetError(err: unknown): string {
    if (err instanceof ApiError) {
      switch (err.code) {
        case "insufficient_balance": return "Insufficient balance";
        case "rate_limited":         return "Slow down — wait a moment";
        case "below_min":            return "Bet is below the minimum";
        case "above_max":            return "Bet is above the maximum";
        case "max_win_exceeded":     return "Bet too high for this target";
        case "daily_limit":          return "Daily win limit reached";
        case "invalid_params":       return "Invalid target";
        case "unauthenticated":      return "Session expired — reopen the app";
        case "http_502":
        case "http_503":             return "Server is restarting — try again";
        default:                     return `Bet failed (${err.code})`;
      }
    }
    return "Bet failed. Check your connection.";
  }

  const animateRoll = (finalRoll: number, finalWin: boolean) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    // Marker enters colorless; colors itself win/loss at settle so the reveal
    // lands with the number, not before.
    setMarkerWin(null);
    const start = performance.now();
    const DUR = 700;
    // 0..99.99 → 0..100 on the track
    const finalPos = Math.min(100, Math.max(0, finalRoll));
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / DUR);
      if (p < 1) {
        // Ease-out for the marker, jitter for the number
        const eased = 1 - Math.pow(1 - p, 3);
        setMarkerPos(eased * finalPos);
        setRoll(Math.round(Math.random() * 9999) / 100);
        setWin(null);
        animRef.current = requestAnimationFrame(step);
      } else {
        setMarkerPos(finalPos);
        setMarkerWin(finalWin);
        setRoll(finalRoll);
        setWin(finalWin);
        animRef.current = null;
      }
    };
    animRef.current = requestAnimationFrame(step);
  };

  const onSlider = (v: number) => {
    const clamped = Math.max(DICE_MIN_TARGET, Math.min(DICE_MAX_TARGET, v));
    setTarget(Math.round(clamped * 100) / 100);
    // Moving the slider between rolls clears the previous marker so the
    // track reads cleanly for the next bet.
    if (!busy && markerPos != null) {
      setMarkerPos(null);
      setMarkerWin(null);
      setWin(null);
    }
  };

  const flipSide = () => setOver((v) => !v);
  const half = () => {
    const v = Math.max(0, (parseFloat(amount) || 0) / 2);
    setAmount(v ? v.toFixed(4).replace(/\.?0+$/, "") : "0");
  };
  const double = () => {
    const v = (parseFloat(amount) || 0) * 2;
    setAmount(v ? v.toFixed(4).replace(/\.?0+$/, "") : "0");
  };

  // Slider visuals: fill covers the winning range, pin sits at the target.
  const targetPct = ((target - DICE_MIN_TARGET) / (DICE_MAX_TARGET - DICE_MIN_TARGET)) * 100;
  const fillStyle = over
    ? { left: `${targetPct}%`, right: "0%" }
    : { left: "0%", right: `${100 - targetPct}%` };

  const betReady = !busy && (parseFloat(amount) || 0) > 0;

  return (
    <div className="sg-screen">
      <div className="sg-head">
        <button className="stake-game-back" onClick={onBack} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="sg-title">Dice</div>
        <button className="sg-head-btn" onClick={onOpenFairness} type="button" aria-label="Fairness">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" />
          </svg>
          Fairness
        </button>
      </div>

      <div className="sg-stage dice-stage">
        <div
          className={`dice-stage-roll ${
            win === true ? "is-win" : win === false ? "is-loss" : ""
          }`}
        >
          {roll == null ? "0.00" : roll.toFixed(2)}
        </div>
        <div
          className={`dice-stage-sub ${
            win === true ? "is-win" : win === false ? "is-loss" : ""
          }`}
        >
          {win === true && lastPayout
            ? `+${fmtTon(BigInt(lastPayout) - tonToNano(parseFloat(amount) || 0))} TON`
            : win === false
              ? "Loss"
              : "Place a bet"}
        </div>
      </div>

      <div className="sg-panel">
        <div className="dice-slider-box">
          <div className="dice-slider-track">
            <div className="dice-slider-fill" style={fillStyle} />
            <div className="dice-slider-pin" style={{ left: `${targetPct}%` }} />
            {markerPos != null && (
              <div
                className={`dice-roll-marker ${
                  markerWin === true ? "is-win" : markerWin === false ? "is-loss" : ""
                }`}
                style={{ left: `${markerPos}%` }}
              >
                <span className="dice-roll-marker-bubble">
                  {roll != null ? roll.toFixed(2) : ""}
                </span>
              </div>
            )}
            <input
              className="dice-slider-input"
              type="range"
              min={DICE_MIN_TARGET}
              max={DICE_MAX_TARGET}
              step={0.01}
              value={target}
              onChange={(e) => onSlider(parseFloat(e.target.value))}
              aria-label="Target"
            />
          </div>
          <div className="dice-slider-scale">
            <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
          </div>
        </div>

        <div className="dice-stats">
          <div className="dice-stat-card">
            <div className="dice-stat-lbl">Multiplier</div>
            <div className="dice-stat-val">{mult.toFixed(4)}×</div>
          </div>
          <div className="dice-stat-card">
            <div className="dice-stat-lbl">Roll {over ? "Over" : "Under"}</div>
            <div className="dice-stat-val">
              <span>{target.toFixed(2)}</span>
              <button className="dice-stat-flip" onClick={flipSide} type="button" aria-label="Flip side">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
              </button>
            </div>
          </div>
          <div className="dice-stat-card">
            <div className="dice-stat-lbl">Win chance</div>
            <div className="dice-stat-val">{(chance * 100).toFixed(2)}%</div>
          </div>
        </div>

        <div className="sg-field">
          <div className="sg-field-head">
            <span>Bet amount</span>
            <span className="sg-field-head-val">${profit > 0 ? profit.toFixed(4) : "0.00"}</span>
          </div>
          <div className="sg-input-row">
            <input
              className="sg-input"
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <span className="sg-input-suffix">TON</span>
            <button className="sg-input-btn" onClick={half} type="button">½</button>
            <button className="sg-input-btn" onClick={double} type="button">2×</button>
          </div>
        </div>

        <button className="sg-cta" onClick={play} disabled={!betReady} type="button">
          {busy ? "Rolling…" : "Bet"}
        </button>
      </div>
    </div>
  );
}
