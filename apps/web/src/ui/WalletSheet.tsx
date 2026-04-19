import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api, ApiError } from "../net/api";
import { useWalletStore } from "../state/walletStore";

interface DepositInfo {
  chainId: "ton";
  address: string;
  memo: string;
  network: "mainnet" | "testnet";
}

const NANO = 1_000_000_000n;
function fmtTon(n: bigint): string {
  const w = n / NANO;
  const f = (n % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

interface Props {
  onClose: () => void;
}

export function WalletSheet({ onClose }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [info, setInfo] = useState<DepositInfo | null>(null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [withdrawAddr, setWithdrawAddr] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [anonEnabled, setAnonEnabled] = useState(false);

  // Fetch current anon state
  useEffect(() => {
    api<{ anonMode?: boolean }>("/me")
      .then((me) => setAnonEnabled(!!me.anonMode))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api<DepositInfo>("/wallet/deposit")
      .then((d) => {
        setInfo(d);
        const link = `ton://transfer/${d.address}?text=${encodeURIComponent(d.memo)}`;
        QRCode.toDataURL(link, { width: 220, margin: 1 }).then(setQrSrc);
      })
      .catch(() => setMsg("Couldn't load deposit info. Try again shortly."));
  }, []);

  const submitWithdraw = async () => {
    setMsg(null);
    try {
      const ton = parseFloat(withdrawAmt);
      if (!Number.isFinite(ton) || ton <= 0) throw new Error("invalid amount");
      const [whole, frac = ""] = withdrawAmt.split(".");
      const nano = BigInt(whole!) * NANO + BigInt((frac + "000000000").slice(0, 9) || "0");
      const r = await api<{ withdrawalId: string; status: string }>("/wallet/withdraw", {
        method: "POST",
        body: JSON.stringify({ toAddress: withdrawAddr.trim(), amountNano: nano.toString() }),
      });
      setMsg(`Withdrawal queued (${r.status}). It will be sent shortly.`);
    } catch (err: unknown) {
      setMsg(humanizeWithdrawError(err));
    }
  };

  function humanizeWithdrawError(err: unknown): string {
    if (err instanceof ApiError) {
      switch (err.code) {
        case "insufficient_balance": return "Insufficient balance";
        case "invalid_address":      return "Invalid TON address";
        case "below_min":            return "Amount is below the minimum";
        case "above_max":            return "Amount is above the maximum";
        case "daily_limit":          return "Daily withdraw limit reached";
        case "rate_limited":         return "Wait a moment before withdrawing again";
        case "cooldown":             return "Withdraw cooldown — try again shortly";
        case "demo_mode":            return "Withdrawals disabled in demo mode";
        case "http_502":
        case "http_503":             return "Server is restarting — try again";
        default:                     return `Withdraw failed (${err.code})`;
      }
    }
    if (err instanceof Error && err.message === "invalid amount") return "Invalid amount";
    return "Withdraw failed. Check your connection.";
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Wallet</h3>
        <div style={{ color: "var(--muted)", marginBottom: 12 }}>
          Balance: <strong style={{ color: "var(--text)" }}>{fmtTon(balance)} TON</strong>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            className="bet-preset"
            style={{ flex: 1, color: tab === "deposit" ? "var(--text)" : "var(--muted)" }}
            onClick={() => setTab("deposit")}
          >
            Deposit
          </button>
          <button
            className="bet-preset"
            style={{ flex: 1, color: tab === "withdraw" ? "var(--text)" : "var(--muted)" }}
            onClick={() => setTab("withdraw")}
          >
            Withdraw
          </button>
        </div>

        {tab === "deposit" && info && (
          <>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              Send TON to the address with the memo. {info.network === "testnet" ? "Testnet only." : ""}
            </div>
            {qrSrc && (
              <div className="qr">
                <img src={qrSrc} alt="deposit QR" />
              </div>
            )}
            <div className="row">
              <code>{info.address}</code>
              <button className="bet-preset" onClick={() => navigator.clipboard.writeText(info.address)}>
                Copy
              </button>
            </div>
            <div className="row">
              <code>memo: {info.memo}</code>
              <button className="bet-preset" onClick={() => navigator.clipboard.writeText(info.memo)}>
                Copy
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 8 }}>
              You MUST include the memo or your deposit will not be credited.
            </div>
          </>
        )}

        {tab === "withdraw" && (
          <>
            <input
              className="bet-input"
              style={{ width: "100%", marginBottom: 8 }}
              placeholder="TON destination address"
              value={withdrawAddr}
              onChange={(e) => setWithdrawAddr(e.target.value)}
            />
            <input
              className="bet-input"
              type="number"
              inputMode="decimal"
              style={{ width: "100%" }}
              placeholder="Amount (TON)"
              value={withdrawAmt}
              onChange={(e) => setWithdrawAmt(e.target.value)}
            />
            <button className="primary" onClick={submitWithdraw}>
              Withdraw
            </button>
          </>
        )}

        {msg && <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>{msg}</div>}

        <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Anonymous mode</div>
            <div style={{ fontSize: 11, color: "var(--t3)" }}>Hide your name in games</div>
          </div>
          <button
            className="bet-preset"
            style={{ padding: "6px 14px" }}
            onClick={async () => {
              try {
                const res = await api<{ anonMode: boolean; anonName: string | null }>("/me/anon", {
                  method: "POST",
                  body: JSON.stringify({ enabled: !anonEnabled }),
                });
                setAnonEnabled(res.anonMode);
                setMsg(res.anonMode ? `Anonymous: ${res.anonName}` : "Anonymous mode off");
              } catch {
                setMsg("Couldn't toggle anonymous mode");
              }
            }}
          >
            {anonEnabled ? "ON" : "OFF"}
          </button>
        </div>

        <button
          className="bet-preset"
          style={{ width: "100%", marginTop: 8 }}
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
