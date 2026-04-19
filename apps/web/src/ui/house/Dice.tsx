import { useEffect, useRef, useState } from "react";
import {
  DICE_MIN_TARGET,
  DICE_MAX_TARGET,
  diceMultiplier,
  diceWinChance,
} from "@conetic/shared";
import { api } from "../../net/api";
import { haptic, notify } from "../../telegram/initWebApp";
import { useWalletStore } from "../../state/walletStore";

const NANO = 1_000_000_000n;
const PRESETS = [1, 5, 10, 100];

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
  serverSeedHash: string;
  clientSeedHex: string;
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
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [lastWin, setLastWin] = useState<boolean | null>(null);
  const [lastPayout, setLastPayout] = useState<string | null>(null);
  const animRef = useRef<number | null>(null);

  const chance = diceWinChance({ target, over });
  const mult = diceMultiplier({ target, over });

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  const roll = async () => {
    const ton = parseFloat(amount);
    if (!Number.isFinite(ton) || ton <= 0) { onError?.("invalid amount"); return; }
    const nano = tonToNano(ton);
    if (nano > balance) { onError?.("insufficient balance"); notify("error"); return; }
    if (busy) return;
    setBusy(true);
    haptic("light");
    try {
      const r: PlayResult = await api("/single/dice/play", {
        method: "POST",
        body: JSON.stringify({ amountNano: nano.toString(), target, over }),
      });
      animateRoll(r.outcome.roll);
      setLastWin(r.outcome.win);
      setLastPayout(r.payoutNano);
      setBalance(BigInt(r.newBalanceNano));
      notify(r.outcome.win ? "success" : "warning");
    } catch (err: any) {
      notify("error");
      const msg: string = err?.message ?? "failed";
      if (msg.includes("insufficient")) onError?.("insufficient balance");
      else if (msg.includes("rate_limited")) onError?.("too fast");
      else if (msg.includes("max_win")) onError?.("stake too high for this target");
      else if (msg.includes("daily_limit")) onError?.("daily win limit reached");
      else onError?.(msg.slice(0, 60));
    } finally {
      setBusy(false);
    }
  };

  const animateRoll = (finalRoll: number) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const start = performance.now();
    const DUR = 900;
    const step = (t: number) => {
      const progress = Math.min(1, (t - start) / DUR);
      // Ease-out: rapid spin that settles on the real value.
      const eased = 1 - Math.pow(1 - progress, 3);
      if (progress < 1) {
        // Jittery preview
        setLastRoll(Math.round(Math.random() * 9999) / 100);
        animRef.current = requestAnimationFrame(step);
      } else {
        setLastRoll(finalRoll);
        animRef.current = null;
      }
      // Keep eased referenced to avoid lint
      void eased;
    };
    animRef.current = requestAnimationFrame(step);
  };

  const presetBet = (t: number) => setAmount(String(t));
  const onSliderChange = (v: number) => {
    const clamped = Math.max(DICE_MIN_TARGET, Math.min(DICE_MAX_TARGET, v));
    setTarget(Math.round(clamped * 100) / 100);
  };

  return (
    <div className="house-game">
      <div className="house-game-topbar">
        <button className="link-btn" onClick={onBack}>← Back</button>
        <div className="house-game-title">Dice</div>
        <button className="link-btn" onClick={onOpenFairness} aria-label="Fairness">🛡️</button>
      </div>

      <div className="dice-result">
        <div className={`dice-roll ${lastWin === true ? "win" : lastWin === false ? "loss" : ""}`}>
          {lastRoll == null ? "—" : lastRoll.toFixed(2)}
        </div>
        <div className="dice-result-sub">
          {lastWin === true && lastPayout
            ? <span className="win-text">+{fmtTon(BigInt(lastPayout) - tonToNano(parseFloat(amount) || 0))} TON</span>
            : lastWin === false
              ? <span className="loss-text">Loss</span>
              : <span className="muted">Roll to play</span>}
        </div>
      </div>

      <div className="dice-slider-wrap">
        <div className="dice-slider-track" style={{
          background: over
            ? `linear-gradient(to right, var(--b2) 0%, var(--b2) ${target}%, var(--win) ${target}%, var(--win) 100%)`
            : `linear-gradient(to right, var(--win) 0%, var(--win) ${target}%, var(--b2) ${target}%, var(--b2) 100%)`,
        }}>
          <input
            className="dice-slider"
            type="range"
            min={DICE_MIN_TARGET}
            max={DICE_MAX_TARGET}
            step={0.01}
            value={target}
            onChange={(e) => onSliderChange(parseFloat(e.target.value))}
          />
        </div>
        <div className="dice-slider-labels">
          <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
        </div>
      </div>

      <div className="dice-stats">
        <div className="dice-stat">
          <div className="dice-stat-label">Multiplier</div>
          <div className="dice-stat-value">{mult.toFixed(4)}×</div>
        </div>
        <div className="dice-stat">
          <div className="dice-stat-label">Win chance</div>
          <div className="dice-stat-value">{(chance * 100).toFixed(2)}%</div>
        </div>
        <div className="dice-stat">
          <div className="dice-stat-label">Roll {over ? "Over" : "Under"}</div>
          <div className="dice-stat-value">
            <button className="dice-toggle" onClick={() => setOver((v) => !v)}>
              {target.toFixed(2)} ⇄
            </button>
          </div>
        </div>
      </div>

      <div className="dice-bet-row">
        <input
          className="bet-input"
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Bet (TON)"
        />
        {PRESETS.map((p) => (
          <button key={p} className="bet-preset" type="button" onClick={() => presetBet(p)} disabled={busy}>
            {p}
          </button>
        ))}
      </div>

      <button className="primary dice-roll-btn" onClick={roll} disabled={busy}>
        {busy ? "Rolling…" : `Roll ${over ? "Over" : "Under"} ${target.toFixed(2)}`}
      </button>
    </div>
  );
}
