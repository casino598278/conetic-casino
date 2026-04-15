import { useEffect, useMemo, useState } from "react";

const NANO = 1_000_000_000n;
function fmtTon(s: string): string {
  const n = BigInt(s);
  const w = n / NANO;
  const f = (n % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

interface Props {
  username: string;
  payoutNano: string;
  multiplier: number;
  photoUrl: string | null;
  isMe: boolean;
  onClose: () => void;
}

interface Confetti {
  id: number;
  left: number;
  delay: number;
  color: string;
  rotate: number;
  size: number;
}

const COLORS = ["#f5c14b", "#ffd76e", "#ff8a4c", "#6ee3a3", "#ff6b78", "#b39dff", "#ff8fc7"];

export function WinScreen({ username, payoutNano, multiplier, photoUrl, isMe, onClose }: Props) {
  const [in1, setIn1] = useState(false);

  const confetti = useMemo<Confetti[]>(
    () =>
      Array.from({ length: 80 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 1.5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
        rotate: Math.random() * 360,
        size: 5 + Math.random() * 8,
      })),
    [],
  );

  useEffect(() => {
    requestAnimationFrame(() => setIn1(true));
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [onClose]);

  const initials = username.replace(/^@/, "").slice(0, 2).toUpperCase();

  return (
    <div className={`win-screen ${in1 ? "in" : ""}`}>
      <div className="win-confetti">
        {confetti.map((c) => (
          <span
            key={c.id}
            style={{
              left: `${c.left}%`,
              animationDelay: `${c.delay}s`,
              background: c.color,
              transform: `rotate(${c.rotate}deg)`,
              width: c.size,
              height: c.size * 0.4,
            }}
          />
        ))}
      </div>

      <button className="win-screen-close" onClick={onClose} aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
        </svg>
      </button>

      <div className="win-screen-title">{isMe ? "You won" : `${username} won`}</div>

      <div className="win-screen-avatar">
        {photoUrl ? (
          <img src={`/api/avatar?url=${encodeURIComponent(photoUrl)}`} alt="" />
        ) : (
          <span>{initials}</span>
        )}
      </div>

      <div className="win-screen-amounts">
        <span className="win-screen-amount">{fmtTon(payoutNano)} TON</span>
        <span className="win-screen-mult">{multiplier.toFixed(2)}x</span>
      </div>
    </div>
  );
}
