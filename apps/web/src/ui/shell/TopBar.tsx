import { useWalletStore } from "../../state/walletStore";

const NANO = 1_000_000_000n;
function fmtTon(nano: bigint): string {
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 2).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}.00`;
}

interface Props {
  onOpenWallet: () => void;
  onOpenSearch: () => void;
  onOpenMenu: () => void;
}

export function TopBar({ onOpenWallet, onOpenSearch, onOpenMenu }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const user = useWalletStore((s) => s.user);
  const initial = (user?.firstName ?? user?.username ?? "?").slice(0, 1).toUpperCase();

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
          <span className="stake-wallet-amount">{fmtTon(balance)}</span>
          <span className="stake-wallet-ccy">TON</span>
          <span className="stake-wallet-cta">Wallet</span>
        </button>
        <button
          type="button"
          className="stake-icon-btn"
          onClick={onOpenSearch}
          aria-label="Search"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
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
