import { create } from "zustand";

interface WalletState {
  user: { id: string; tgId: number; username: string | null; firstName: string; photoUrl: string | null } | null;
  balanceNano: bigint;
  setUser: (u: WalletState["user"]) => void;
  setBalance: (nano: bigint) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  user: null,
  balanceNano: 0n,
  setUser: (u) => set({ user: u }),
  setBalance: (nano) => set({ balanceNano: nano }),
}));
