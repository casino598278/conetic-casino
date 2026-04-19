import { useEffect, useRef, useState } from "react";
import {
  DICE_MIN_TARGET,
  DICE_MAX_TARGET,
  diceMultiplier,
  diceWinChance,
  HOUSE_RTP,
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
function nanoToTonDisplay(nano: bigint): string {
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
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

function clampTarget(t: number): number {
  if (!Number.isFinite(t)) return DICE_MIN_TARGET;
  return Math.max(DICE_MIN_TARGET, Math.min(DICE_MAX_TARGET, t));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function Dice({ onBack, onError, onOpenFairness }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const setBalance = useWalletStore((s) => s.setBalance);

  const [target, setTarget] = useState(50.5);
  const [over, setOver] = useState(true);
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  // Separate from `busy` so the Bet button stays disabled during the roll
  // animation even after the API call has returned.
  const [rolling, setRolling] = useState(false);
  const [roll, setRoll] = useState<number | null>(null);
  const [win, setWin] = useState<boolean | null>(null);
  const [lastPayout, setLastPayout] = useState<string | null>(null);
  const [markerPos, setMarkerPos] = useState<number | null>(null);
  const [markerWin, setMarkerWin] = useState<boolean | null>(null);
  const animRef = useRef<number | null>(null);

  // Local editable buffers for the three stat fields so a partial edit like
  // "2." doesn't fight the number state. Synced from `target`/`over` on blur.
  const [multStr, setMultStr] = useState("");
  const [chanceStr, setChanceStr] = useState("");
  const [targetStr, setTargetStr] = useState("");

  const chance = diceWinChance({ target, over });
  const mult = diceMultiplier({ target, over });
  const profitTon = (parseFloat(amount) || 0) * (mult - 1);

  // Keep the buffers in sync whenever `target`/`over` change via the slider.
  useEffect(() => {
    setMultStr(mult.toFixed(4));
    setChanceStr((chance * 100).toFixed(2));
    setTargetStr(target.toFixed(2));
  }, [target, over]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  const clearMarker = () => {
    if (markerPos != null) {
      setMarkerPos(null);
      setMarkerWin(null);
      setWin(null);
    }
  };

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

  // ~0.8s eased roll: marker and the big number both travel from their last
  // position (or 0) to the final roll via ease-out cubic. Win/loss colour
  // only commits at the end so the reveal lands with the settle.
  const animateRoll = (finalRoll: number, finalWin: boolean) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const startPos = markerPos ?? 0;
    const startRoll = roll ?? 0;
    const finalPos = Math.min(100, Math.max(0, finalRoll));
    const start = performance.now();
    const DUR = 800;
    setRolling(true);
    // Reset colours so mid-animation the marker reads neutral, not last-win.
    setMarkerWin(null);
    setWin(null);
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / DUR);
      const eased = 1 - Math.pow(1 - p, 3);
      setMarkerPos(startPos + (finalPos - startPos) * eased);
      setRoll(startRoll + (finalRoll - startRoll) * eased);
      if (p < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        setMarkerPos(finalPos);
        setRoll(finalRoll);
        setMarkerWin(finalWin);
        setWin(finalWin);
        setRolling(false);
        animRef.current = null;
      }
    };
    animRef.current = requestAnimationFrame(step);
  };

  const onSlider = (v: number) => {
    setTarget(round2(clampTarget(v)));
    if (!busy) clearMarker();
  };

  // Flip preserves the effective win chance: Over 50.5 swaps to Under 49.5,
  // so multiplier and win-chance stay the same — only the winning side flips.
  const flipSide = () => {
    const newOver = !over;
    const newTarget = round2(clampTarget(DICE_MAX_TARGET + DICE_MIN_TARGET - target));
    setOver(newOver);
    setTarget(newTarget);
    if (!busy) clearMarker();
  };

  // Commit an edited multiplier: invert the formula to find the target that
  // yields that multiplier on the current side.
  const commitMult = () => {
    const m = parseFloat(multStr);
    if (!Number.isFinite(m) || m <= 1) { setMultStr(mult.toFixed(4)); return; }
    const newChance = HOUSE_RTP / m;
    const pct = Math.max(0, Math.min(1, newChance)) * 100;
    const newTarget = over ? DICE_MAX_TARGET + DICE_MIN_TARGET - pct : pct;
    setTarget(round2(clampTarget(newTarget)));
    if (!busy) clearMarker();
  };

  // Commit an edited win-chance (in %): invert back to target.
  const commitChance = () => {
    const pct = parseFloat(chanceStr);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      setChanceStr((chance * 100).toFixed(2));
      return;
    }
    const newTarget = over ? DICE_MAX_TARGET + DICE_MIN_TARGET - pct : pct;
    setTarget(round2(clampTarget(newTarget)));
    if (!busy) clearMarker();
  };

  // Commit an edited target: just clamp and set.
  const commitTarget = () => {
    const t = parseFloat(targetStr);
    if (!Number.isFinite(t)) { setTargetStr(target.toFixed(2)); return; }
    setTarget(round2(clampTarget(t)));
    if (!busy) clearMarker();
  };

  const setAmountNano = (nano: bigint) => {
    if (nano <= 0n) { setAmount("0"); return; }
    setAmount(nanoToTonDisplay(nano));
  };
  const half = () => setAmountNano(tonToNano(parseFloat(amount) || 0) / 2n);
  const double = () => {
    const doubled = tonToNano(parseFloat(amount) || 0) * 2n;
    setAmountNano(doubled > balance ? balance : doubled);
  };

  const targetPct = ((target - DICE_MIN_TARGET) / (DICE_MAX_TARGET - DICE_MIN_TARGET)) * 100;
  const fillStyle = over
    ? { left: `${targetPct}%`, right: "0%" }
    : { left: "0%", right: `${100 - targetPct}%` };

  const betReady = !busy && !rolling && (parseFloat(amount) || 0) > 0;

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
        <div className={`dice-stage-roll ${win === true ? "is-win" : win === false ? "is-loss" : ""}`}>
          {roll == null ? "0.00" : roll.toFixed(2)}
        </div>
        <div className={`dice-stage-sub ${win === true ? "is-win" : win === false ? "is-loss" : ""}`}>
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
                className={`dice-roll-marker ${markerWin === true ? "is-win" : markerWin === false ? "is-loss" : ""}`}
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
            <input
              className="dice-stat-input"
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="1.0001"
              value={multStr}
              onChange={(e) => setMultStr(e.target.value)}
              onBlur={commitMult}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </div>
          <div className="dice-stat-card">
            <div className="dice-stat-lbl">Roll {over ? "Over" : "Under"}</div>
            <div className="dice-stat-val">
              <input
                className="dice-stat-input dice-stat-input-inline"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={DICE_MIN_TARGET}
                max={DICE_MAX_TARGET}
                value={targetStr}
                onChange={(e) => setTargetStr(e.target.value)}
                onBlur={commitTarget}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
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
            <input
              className="dice-stat-input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              max="99.99"
              value={chanceStr}
              onChange={(e) => setChanceStr(e.target.value)}
              onBlur={commitChance}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </div>
        </div>

        <div className="sg-field">
          <div className="sg-field-head">
            <span>Bet amount</span>
            <span className="sg-field-head-val">
              Profit&nbsp;{profitTon > 0 ? profitTon.toFixed(4).replace(/\.?0+$/, "") : "0"}&nbsp;TON
            </span>
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
          {busy || rolling ? "Rolling…" : "Bet"}
        </button>
      </div>
    </div>
  );
}
