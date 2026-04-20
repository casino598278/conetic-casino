import { useWalletStore } from "../../state/walletStore";
import { usePriceStore, fmtNanoUsd } from "../../state/priceStore";

interface Props {
  onOpenWallet: () => void;
  onOpenProfile: () => void;
}

export function TopBar({ onOpenWallet, onOpenProfile }: Props) {
  const balance = useWalletStore((s) => s.balanceNano);
  const user = useWalletStore((s) => s.user);
  const usdPerTon = usePriceStore((s) => s.usdPerTon);
  const initial = (user?.firstName ?? user?.username ?? "?").slice(0, 1).toUpperCase();
  // `null` for user OR price → show neutral placeholder instead of flashing.
  const balanceStr = user && usdPerTon != null ? fmtNanoUsd(balance, usdPerTon) : "—";

  return (
    <header className="stake-topbar">
      <div className="stake-topbar-left" aria-hidden />
      <div className="stake-topbar-right">
        <button
          type="button"
          className="stake-wallet-pill"
          onClick={onOpenWallet}
          aria-label="Wallet"
        >
          <span className="stake-wallet-amount">{balanceStr}</span>
          <span className="stake-wallet-cta">Wallet</span>
        </button>
        <button
          type="button"
          className="stake-avatar-btn"
          onClick={onOpenProfile}
          aria-label="Profile"
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
