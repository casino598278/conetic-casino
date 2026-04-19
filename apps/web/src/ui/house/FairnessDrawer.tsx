import { useEffect, useState } from "react";
import { api } from "../../net/api";

interface SeedState {
  serverSeedHash: string;
  previousServerSeedHex: string | null;
  clientSeedHex: string;
  nextNonce: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function randomClientSeed(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function FairnessDrawer({ open, onClose }: Props) {
  const [seed, setSeed] = useState<SeedState | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientEdit, setClientEdit] = useState("");

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const s: SeedState = await api("/single/seed");
        setSeed(s);
        setClientEdit(s.clientSeedHex);
      } catch {/* ignore */}
    })();
  }, [open]);

  const rotate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r: SeedState & { revealedServerSeedHex: string | null } = await api("/single/seed/rotate", {
        method: "POST",
        body: JSON.stringify({ clientSeedHex: randomClientSeed() }),
      });
      setRevealed(r.revealedServerSeedHex);
      setSeed(r);
      setClientEdit(r.clientSeedHex);
    } finally {
      setBusy(false);
    }
  };

  const saveClientSeed = async () => {
    if (busy || !/^[0-9a-f]{32}$/.test(clientEdit)) return;
    setBusy(true);
    try {
      const s: SeedState = await api("/single/seed/client", {
        method: "POST",
        body: JSON.stringify({ clientSeedHex: clientEdit }),
      });
      setSeed(s);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Provably Fair</h3>
        {!seed ? (
          <div className="muted">Loading…</div>
        ) : (
          <div className="fair-body">
            <div className="fair-row">
              <label>Server seed hash (committed)</label>
              <code className="fair-mono">{seed.serverSeedHash}</code>
            </div>
            <div className="fair-row">
              <label>Client seed (editable)</label>
              <input
                className="bet-input"
                value={clientEdit}
                onChange={(e) => setClientEdit(e.target.value.trim().toLowerCase())}
                style={{ fontFamily: "monospace", fontSize: 11 }}
              />
              <button className="bet-preset" onClick={saveClientSeed} disabled={busy}>Save client seed</button>
            </div>
            <div className="fair-row">
              <label>Next nonce</label>
              <code className="fair-mono">{seed.nextNonce}</code>
            </div>
            {revealed && (
              <div className="fair-row">
                <label>Previous server seed (now revealed — verify any play under it)</label>
                <code className="fair-mono">{revealed}</code>
              </div>
            )}
            <button className="primary" onClick={rotate} disabled={busy} style={{ marginTop: 10 }}>
              {busy ? "…" : "Rotate server seed"}
            </button>
            <button className="bet-preset" onClick={onClose} style={{ marginTop: 8, width: "100%" }}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
