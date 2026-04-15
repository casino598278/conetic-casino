import { useState } from "react";
import { commitServerSeed, deriveOutcome, simulateTrajectory, buildWedges, pointToWedge } from "@conetic/shared";

interface RoundInput {
  serverSeedHex: string;
  serverSeedHash: string;
  clientSeedsHex: string[];
  roundId: number;
  potNano: string;
  players: { userId: string; stakeNano: string }[];
}

interface Props {
  initial?: RoundInput;
  onClose: () => void;
}

export function FairnessModal({ initial, onClose }: Props) {
  const [seed, setSeed] = useState(initial?.serverSeedHex ?? "");
  const [hash, setHash] = useState(initial?.serverSeedHash ?? "");
  const [clientSeeds, setClientSeeds] = useState((initial?.clientSeedsHex ?? []).join("\n"));
  const [roundId, setRoundId] = useState(initial?.roundId.toString() ?? "");
  const [output, setOutput] = useState<string | null>(null);

  const verify = async () => {
    setOutput("Verifying…");
    try {
      const computedHash = await commitServerSeed(seed);
      const hashOk = computedHash === hash;
      const cs = clientSeeds.split(/\s+/).filter(Boolean);
      const outcome = await deriveOutcome({
        serverSeedHex: seed,
        clientSeedsHex: cs,
        roundId: parseInt(roundId, 10),
      });
      const traj = simulateTrajectory(outcome.macHex);

      let winnerSummary = "(provide players + pot to compute winner)";
      if (initial) {
        const players = initial.players.map((p) => ({
          userId: p.userId,
          tgId: 0,
          username: null,
          firstName: p.userId,
          photoUrl: null,
          stakeNano: p.stakeNano,
          clientSeedHex: "00".repeat(16),
        }));
        const wedges = buildWedges(players, BigInt(initial.potNano));
        const winner = pointToWedge(traj.resting, wedges);
        winnerSummary = winner ? `winner = ${winner.userId}` : "no winner";
      }

      setOutput(
        [
          `serverSeed hash matches commit: ${hashOk}`,
          `mac (trajectory seed): ${outcome.macHex}`,
          `r (informational):     ${outcome.r.toFixed(8)}`,
          `resting point:         (${traj.resting.x.toFixed(5)}, ${traj.resting.y.toFixed(5)})`,
          winnerSummary,
        ].join("\n"),
      );
    } catch (err: any) {
      setOutput(`error: ${err.message}`);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Verify a round</h3>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          Paste the revealed serverSeed + commit hash + client seeds and round ID. The
          computation runs entirely in your browser.
        </div>
        <input className="bet-input" style={{ width: "100%", marginBottom: 6 }} placeholder="serverSeed (64 hex)"
          value={seed} onChange={(e) => setSeed(e.target.value)} />
        <input className="bet-input" style={{ width: "100%", marginBottom: 6 }} placeholder="serverSeedHash"
          value={hash} onChange={(e) => setHash(e.target.value)} />
        <textarea className="bet-input" style={{ width: "100%", height: 80, marginBottom: 6 }}
          placeholder="clientSeeds, one per line" value={clientSeeds}
          onChange={(e) => setClientSeeds(e.target.value)} />
        <input className="bet-input" style={{ width: "100%", marginBottom: 6 }} placeholder="round id"
          value={roundId} onChange={(e) => setRoundId(e.target.value)} />
        <button className="primary" onClick={verify}>Verify</button>
        {output && (
          <pre style={{
            background: "var(--panel-2)", padding: 10, borderRadius: 8,
            fontSize: 11, marginTop: 12, whiteSpace: "pre-wrap", wordBreak: "break-all",
          }}>{output}</pre>
        )}
        <button className="bet-preset" style={{ width: "100%", marginTop: 12 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
