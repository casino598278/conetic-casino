import { TonAdapter } from "./ton/tonAdapter.js";
import type { ChainAdapter, ChainId } from "./chain.js";

const adapters = new Map<ChainId, ChainAdapter>();
adapters.set("ton", new TonAdapter());

export function getAdapter(chainId: ChainId): ChainAdapter {
  const a = adapters.get(chainId);
  if (!a) throw new Error(`no adapter for chain ${chainId}`);
  return a;
}

export function listChains(): ChainId[] {
  return [...adapters.keys()];
}
