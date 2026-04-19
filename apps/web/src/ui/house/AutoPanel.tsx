import { useEffect, useRef, useState } from "react";

const NANO = 1_000_000_000n;

function tonToNano(ton: number): bigint {
  if (!Number.isFinite(ton) || ton <= 0) return 0n;
  const s = ton.toFixed(9);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * NANO + BigInt(frac.padEnd(9, "0").slice(0, 9));
}
function nanoToTonDisplay(nano: bigint): string {
  if (nano <= 0n) return "0";
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 2).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

type OnResolve = "reset" | "increase";

export interface AutoBetResult {
  win: boolean;
  betNano: bigint;
  payoutNano: bigint;
}

interface Props {
  /** Current user balance in nano. AutoPanel stops if next bet would exceed. */
  balance: bigint;
  /** How long to wait after a bet resolves before firing the next one.
   *  Should cover the game's result animation. Dice: ~600ms, Limbo: ~900ms. */
  settleDelayMs: number;
  /** Starting bet value — mirrored from the Manual tab. */
  initialAmount: string;
  /** Share amount edits back with the Manual tab (so switching modes keeps state). */
  onAmountChange?: (amount: string) => void;
  /** Fires per bet. Must return once the server has responded. Errors throw. */
  placeBet: (amountNano: bigint) => Promise<AutoBetResult>;
  /** Surface errors to the parent toast system. */
  onError: (msg: string) => void;
  /** Parent disables the panel when a manual animation is in-flight. */
  locked?: boolean;
}

export function AutoPanel({
  balance,
  settleDelayMs,
  initialAmount,
  onAmountChange,
  placeBet,
  onError,
  locked,
}: Props) {
  const [amount, setAmount] = useState(initialAmount);
  const [numBets, setNumBets] = useState("0");      // "0" = infinite
  const [onWin, setOnWin] = useState<OnResolve>("reset");
  const [onWinPct, setOnWinPct] = useState("0");    // % to increase
  const [onLoss, setOnLoss] = useState<OnResolve>("reset");
  const [onLossPct, setOnLossPct] = useState("0");
  const [stopProfit, setStopProfit] = useState(""); // TON; "" = no cap
  const [stopLoss, setStopLoss] = useState("");     // TON; "" = no cap

  const [running, setRunning] = useState(false);
  const [netProfitNano, setNetProfitNano] = useState(0n);
  const [betsRun, setBetsRun] = useState(0);

  // Refs so the running loop reads the latest values without retriggering
  // effects. Mutating a setting mid-run takes effect on the next bet.
  const runningRef = useRef(false);
  const settingsRef = useRef({
    amount, numBets, onWin, onWinPct, onLoss, onLossPct,
    stopProfit, stopLoss,
  });
  useEffect(() => {
    settingsRef.current = {
      amount, numBets, onWin, onWinPct, onLoss, onLossPct, stopProfit, stopLoss,
    };
  }, [amount, numBets, onWin, onWinPct, onLoss, onLossPct, stopProfit, stopLoss]);

  useEffect(() => {
    onAmountChange?.(amount);
  }, [amount, onAmountChange]);

  useEffect(() => () => { runningRef.current = false; }, []);

  const half = () => {
    const cur = tonToNano(parseFloat(amount) || 0);
    setAmount(nanoToTonDisplay(cur / 2n));
  };
  const double = () => {
    const doubled = tonToNano(parseFloat(amount) || 0) * 2n;
    setAmount(nanoToTonDisplay(doubled > balance ? balance : doubled));
  };
  const maxBet = () => setAmount(nanoToTonDisplay(balance));

  const stop = () => {
    runningRef.current = false;
    setRunning(false);
  };

  const start = async () => {
    if (runningRef.current || locked) return;
    const s = settingsRef.current;
    const baseNano = tonToNano(parseFloat(s.amount) || 0);
    if (baseNano <= 0n) { onError("Enter a bet amount"); return; }
    if (baseNano > balance) { onError("Insufficient balance"); return; }

    runningRef.current = true;
    setRunning(true);
    setNetProfitNano(0n);
    setBetsRun(0);

    let currentNano = baseNano;
    let net = 0n;
    let count = 0;

    try {
      while (runningRef.current) {
        const live = settingsRef.current;
        const limit = parseInt(live.numBets, 10);
        if (Number.isFinite(limit) && limit > 0 && count >= limit) break;

        // Stop-on-profit / stop-on-loss checks
        const sp = parseFloat(live.stopProfit);
        const sl = parseFloat(live.stopLoss);
        if (Number.isFinite(sp) && sp > 0 && net >= tonToNano(sp)) break;
        if (Number.isFinite(sl) && sl > 0 && -net >= tonToNano(sl)) break;

        // Place the bet
        if (currentNano > balance - net) {
          // If this next stake exceeds what the user could actually place,
          // bail cleanly instead of surfacing "insufficient_balance".
          onError("Insufficient balance for next bet");
          break;
        }

        let result: AutoBetResult;
        try {
          result = await placeBet(currentNano);
        } catch (err: unknown) {
          // placeBet surfaces its own humanised toast; we just stop.
          void err;
          break;
        }
        if (!runningRef.current) break;

        count++;
        setBetsRun(count);

        const delta = result.payoutNano - result.betNano;
        net += delta;
        setNetProfitNano(net);

        // Next-bet size derivation
        if (result.win) {
          currentNano =
            live.onWin === "reset"
              ? baseNano
              : bumpByPct(currentNano, parseFloat(live.onWinPct) || 0);
        } else {
          currentNano =
            live.onLoss === "reset"
              ? baseNano
              : bumpByPct(currentNano, parseFloat(live.onLossPct) || 0);
        }
        if (currentNano <= 0n) currentNano = baseNano;

        // Wait for the game's result animation to settle before next bet.
        await sleep(settleDelayMs);
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  const netStr = nanoToTonDisplay(netProfitNano < 0n ? -netProfitNano : netProfitNano);
  const netSign = netProfitNano > 0n ? "+" : netProfitNano < 0n ? "−" : "";

  return (
    <>
      <div className="sg-field">
        <div className="sg-field-head">
          <span>Bet amount</span>
          {running && (
            <span className={`sg-field-head-val ${netProfitNano > 0n ? "is-win" : netProfitNano < 0n ? "is-loss" : ""}`}>
              Net&nbsp;{netSign}{netStr}
            </span>
          )}
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
            disabled={running}
          />
          <button className="sg-input-btn" onClick={half} type="button" disabled={running}>½</button>
          <button className="sg-input-btn" onClick={double} type="button" disabled={running}>2×</button>
          <button className="sg-input-btn" onClick={maxBet} type="button" disabled={running}>Max</button>
        </div>
      </div>

      <div className="sg-field">
        <div className="sg-field-head">
          <span>Number of bets</span>
          {running && <span className="sg-field-head-val">{betsRun}</span>}
        </div>
        <div className="sg-input-row">
          <input
            className="sg-input"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            placeholder="∞"
            value={numBets}
            onChange={(e) => setNumBets(e.target.value)}
            disabled={running}
          />
        </div>
      </div>

      <div className="sg-two-col">
        <OnResolveField
          label="On Win"
          mode={onWin}
          setMode={setOnWin}
          pct={onWinPct}
          setPct={setOnWinPct}
          disabled={running}
        />
        <OnResolveField
          label="On Loss"
          mode={onLoss}
          setMode={setOnLoss}
          pct={onLossPct}
          setPct={setOnLossPct}
          disabled={running}
        />
      </div>

      <div className="sg-two-col">
        <div className="sg-field">
          <div className="sg-field-head"><span>Stop on profit</span></div>
          <div className="sg-input-row">
            <input
              className="sg-input"
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              placeholder="0"
              value={stopProfit}
              onChange={(e) => setStopProfit(e.target.value)}
              disabled={running}
            />
          </div>
        </div>
        <div className="sg-field">
          <div className="sg-field-head"><span>Stop on loss</span></div>
          <div className="sg-input-row">
            <input
              className="sg-input"
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              placeholder="0"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              disabled={running}
            />
          </div>
        </div>
      </div>

      {running ? (
        <button className="sg-cta sg-cta-stop" onClick={stop} type="button">
          Stop Autobet
        </button>
      ) : (
        <button className="sg-cta" onClick={start} type="button" disabled={locked}>
          Start Autobet
        </button>
      )}
    </>
  );
}

function OnResolveField({
  label, mode, setMode, pct, setPct, disabled,
}: {
  label: string;
  mode: OnResolve;
  setMode: (m: OnResolve) => void;
  pct: string;
  setPct: (p: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="sg-field">
      <div className="sg-field-head"><span>{label}</span></div>
      <div className="sg-on-resolve">
        <div className="sg-on-resolve-toggle">
          <button
            type="button"
            className={`sg-on-resolve-btn ${mode === "reset" ? "is-active" : ""}`}
            onClick={() => setMode("reset")}
            disabled={disabled}
          >
            Reset
          </button>
          <button
            type="button"
            className={`sg-on-resolve-btn ${mode === "increase" ? "is-active" : ""}`}
            onClick={() => setMode("increase")}
            disabled={disabled}
          >
            Increase
          </button>
        </div>
        <div className="sg-input-row sg-on-resolve-pct">
          <input
            className="sg-input"
            type="number"
            inputMode="decimal"
            step="1"
            min="0"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            disabled={disabled || mode === "reset"}
          />
          <span className="sg-input-suffix">%</span>
        </div>
      </div>
    </div>
  );
}

function bumpByPct(nano: bigint, pct: number): bigint {
  if (!Number.isFinite(pct) || pct === 0) return nano;
  // Stay in bigint math: scale by 10000 to preserve 2 decimals of precision.
  const scaled = BigInt(Math.round((100 + pct) * 100));
  const next = (nano * scaled) / 10000n;
  return next > 0n ? next : nano;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
