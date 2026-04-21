// Tiny procedural audio for Swash Booze. No audio files — just Web Audio
// synth. Kept in one place so the component doesn't grow another concern.

type SoundKind =
  | "click"      // UI button tap
  | "spin"       // spin button whoosh
  | "drop"       // symbol landing thud
  | "win"        // cluster clear chime
  | "bigwin"     // big/mega/epic/etc win fanfare
  | "fs-trigger" // 4+ scatters → enter free spins
  | "scatter"    // scatter symbol landing
  | "bomb";      // multiplier bomb reveal

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Resume the audio context on first user gesture (required by autoplay policy). */
export function unlockAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume();
}

function blip(
  freq: number,
  duration: number,
  opts: { type?: OscillatorType; gain?: number; sweepTo?: number; attack?: number } = {},
): void {
  const c = getCtx();
  if (!c || c.state === "suspended") return;
  const { type = "sine", gain = 0.14, sweepTo, attack = 0.005 } = opts;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (sweepTo != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), now + duration);
  }
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

/** Short UI click. */
function playClick() {
  blip(660, 0.06, { type: "triangle", gain: 0.08 });
}

/** Spin button whoosh — two quick rising tones. */
function playSpin() {
  blip(280, 0.12, { type: "sawtooth", gain: 0.1, sweepTo: 520 });
  setTimeout(() => blip(520, 0.1, { type: "sawtooth", gain: 0.08, sweepTo: 720 }), 60);
}

/** Symbol drop — low thump. */
function playDrop() {
  blip(140, 0.08, { type: "sine", gain: 0.12, sweepTo: 90 });
}

/** Cluster clear — sparkly ascending arpeggio. */
function playWin() {
  const notes = [660, 880, 1175];
  notes.forEach((f, i) => setTimeout(() => blip(f, 0.18, { type: "triangle", gain: 0.14 }), i * 70));
}

/** Big win fanfare — longer major chord hit. */
function playBigWin() {
  blip(523, 0.5, { type: "square", gain: 0.08 });
  blip(659, 0.5, { type: "square", gain: 0.08 });
  blip(784, 0.5, { type: "square", gain: 0.08 });
  setTimeout(() => blip(1046, 0.7, { type: "sawtooth", gain: 0.12, sweepTo: 1046 }), 250);
}

/** FS trigger — dramatic rising sweep + chord. */
function playFsTrigger() {
  blip(220, 0.6, { type: "sawtooth", gain: 0.12, sweepTo: 880 });
  setTimeout(() => {
    blip(659, 0.35, { type: "triangle", gain: 0.1 });
    blip(880, 0.35, { type: "triangle", gain: 0.1 });
    blip(1319, 0.5, { type: "triangle", gain: 0.12 });
  }, 400);
}

/** Scatter landing — magical ding. */
function playScatter() {
  blip(1175, 0.22, { type: "triangle", gain: 0.14 });
  setTimeout(() => blip(1568, 0.22, { type: "triangle", gain: 0.12 }), 60);
}

/** Bomb reveal — rising zap. */
function playBomb() {
  blip(400, 0.2, { type: "sawtooth", gain: 0.11, sweepTo: 900 });
}

export function playSwashSound(kind: SoundKind, enabled: boolean): void {
  if (!enabled) return;
  switch (kind) {
    case "click":       return playClick();
    case "spin":        return playSpin();
    case "drop":        return playDrop();
    case "win":         return playWin();
    case "bigwin":      return playBigWin();
    case "fs-trigger":  return playFsTrigger();
    case "scatter":     return playScatter();
    case "bomb":        return playBomb();
  }
}
