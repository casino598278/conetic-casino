import { useWalletStore } from "../../state/walletStore";

const NANO = 1_000_000_000n;
function fmtTon(nano: bigint): string {
  const w = nano / NANO;
  const f = (nano % NANO).toString().padStart(9, "0").slice(0, 2).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

interface Props {
  onOpenWallet: () => void;
  onOpenHistory: () => void;
  onOpenMenu: () => void;
}

export function TopBar({ onOpenWallet, onOpenHistory, onOpenMenu }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const user = useWalletStore((s) => s.user);
  const initial = (user?.firstName ?? user?.username ?? "?").slice(0, 1).toUpperCase();

  return (
    <header className="stake-topbar">
      <div className="stake-topbar-left">
        <span className="stake-logo">CONETIC</span>
      </div>
      <div className="stake-topbar-right">
        <button
          type="button"
          className="stake-balance-pill"
          onClick={onOpenWallet}
          aria-label="Wallet"
        >
          <span className="stake-balance-amount">{fmtTon(balance)}</span>
          <span className="stake-balance-ccy">TON</span>
          <span className="stake-balance-plus" aria-hidden>+</span>
        </button>
        <button
          type="button"
          className="stake-icon-btn"
          onClick={onOpenHistory}
          aria-label="History"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v4l3 2" />
            <circle cx="12" cy="12" r="9" />
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
