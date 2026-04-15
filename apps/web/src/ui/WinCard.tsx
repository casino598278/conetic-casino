import { useEffect, useState } from "react";

const NANO = 1_000_000_000n;
function fmtTon(nanoStr: string): string {
  const n = BigInt(nanoStr);
  const w = n / NANO;
  const f = (n % NANO).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

interface Props {
  username: string;
  payoutNano: string;
  photoUrl: string | null;
  isMe: boolean;
  onDone: () => void;
}

export function WinCard({ username, payoutNano, photoUrl, isMe, onDone }: Props) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(true);
    const t = setTimeout(() => onDone(), 4000);
    return () => clearTimeout(t);
  }, [onDone]);

  const initials = username.replace(/^@/, "").slice(0, 2).toUpperCase();

  return (
    <div className={`win-card ${show ? "in" : ""}`}>
      <div className="win-card-head">{isMe ? "You won" : `${username} won`}</div>
      <div className="win-card-avatar">
        {photoUrl ? (
          <img src={`/api/avatar?url=${encodeURIComponent(photoUrl)}`} alt="" />
        ) : (
          <span>{initials}</span>
        )}
      </div>
      <div className="win-card-amount">{fmtTon(payoutNano)} TON</div>
    </div>
  );
}
