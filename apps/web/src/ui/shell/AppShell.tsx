import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { useNavStore } from "../../state/navStore";

interface Props {
  children: ReactNode;
  onOpenWallet: () => void;
  onOpenProfile: () => void;
}

export function AppShell({ children, onOpenWallet, onOpenProfile }: Props) {
  const tab = useNavStore((s) => s.tab);
  const setTab = useNavStore((s) => s.setTab);

  return (
    <div className="stake-shell">
      <TopBar onOpenWallet={onOpenWallet} onOpenProfile={onOpenProfile} />
      <main className="stake-shell-main">{children}</main>
      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}
