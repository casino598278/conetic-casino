import { useWalletStore } from "../../state/walletStore";

const NANO = 1_000_000_000n;
function fmtTon(nano: bigint): string {
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 2).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}.00`;
}

interface Props {
  onOpenWallet: () => void;
  onOpenMenu: () => void;
}

export function TopBar({ onOpenWallet, onOpenMenu }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const user = useWalletStore((s) => s.user);
  const initial = (user?.firstName ?? user?.username ?? "?").slice(0, 1).toUpperCase();
  // user == null while auth is in flight — show a neutral placeholder
  // rather than flashing "0.00 TON".
  const balanceStr = user ? fmtTon(balance) : "—";

  return (
    <header className="stake-topbar">
      <div className="stake-topbar-left">
        <span className="stake-logo">
          conetic<span className="stake-logo-dot" aria-hidden />
        </span>
      </div>
      <div className="stake-topbar-right">
        <button
          type="button"
          className="stake-wallet-pill"
          onClick={onOpenWallet}
          aria-label="Wallet"
        >
          <span className="stake-wallet-amount">{balanceStr}</span>
          <span className="stake-wallet-ccy">TON</span>
          <span className="stake-wallet-cta">Wallet</span>
        </button>
        <button
          type="button"
          className="stake-avatar-btn"
          onClick={onOpenMenu}
          aria-label="Menu"
        >
          {user?.photoUrl ? (
            <img src={`/api/avatar?url=${encodeURIComponent(user.photoUrl)}`} alt="" />
          ) : (
            <span>{initial}</span>
          )}
        </button>
      </div>
    </header>
  );
}
