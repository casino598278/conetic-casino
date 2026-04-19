import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { useNavStore } from "../../state/navStore";

interface Props {
  children: ReactNode;
  onOpenWallet: () => void;
  onOpenHistory: () => void;
  onOpenMenu: () => void;
}

export function AppShell({ children, onOpenWallet, onOpenHistory, onOpenMenu }: Props) {
  const tab = useNavStore((s) => s.tab);
  const setTab = useNavStore((s) => s.setTab);

  return (
    <div className="stake-shell">
      <TopBar
        onOpenWallet={onOpenWallet}
        onOpenHistory={onOpenHistory}
        onOpenMenu={onOpenMenu}
      />
      <main className="stake-shell-main">{children}</main>
      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}
