// Small tween helpers for the slot stage. No dependency — just plain functions
// + a Promise wrapper around PIXI.Ticker.add so we can `await` animations.
//
// The shape of the API matches what a real slot animation needs:
//   • `tween({ from, to, duration, ease, onUpdate, onComplete })` returns a
//     Promise that resolves when the tween finishes. The caller chains them.
//   • Ease functions take t ∈ [0,1] and return the eased progress.
//
// Kept inline (~1KB gzip) so we don't drag in gsap for what is ultimately
// a handful of position interpolations.

import type { Ticker } from "pixi.js";

export type EaseFn = (t: number) => number;

export const easeLinear: EaseFn = (t) => t;
export const easeOutCubic: EaseFn = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic: EaseFn = (t) => t * t * t;
export const easeInOutCubic: EaseFn = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Overshoots past the target then settles — classic slot reel landing feel. */
export const easeOutBack: EaseFn = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Bouncy landing — used for tumble drops to give each symbol a heft. */
export const easeOutBounce: EaseFn = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { const u = t - 1.5 / d1; return n1 * u * u + 0.75; }
  if (t < 2.5 / d1) { const u = t - 2.25 / d1; return n1 * u * u + 0.9375; }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
};

export interface TweenOptions {
  from: number;
  to: number;
  duration: number;   // ms
  delay?: number;     // ms
  ease?: EaseFn;
  onUpdate: (v: number) => void;
}

/** Run a tween on the shared ticker. Returns a Promise that resolves when
 *  the tween ends. The animation is driven by the Pixi ticker's deltaMS so
 *  it pauses automatically if the tab is hidden. */
export function tween(ticker: Ticker, opts: TweenOptions): Promise<void> {
  const ease = opts.ease ?? easeOutCubic;
  return new Promise((resolve) => {
    let elapsed = -(opts.delay ?? 0);
    const step = (t: Ticker) => {
      elapsed += t.deltaMS;
      if (elapsed < 0) return;
      const p = Math.min(1, elapsed / opts.duration);
      opts.onUpdate(opts.from + (opts.to - opts.from) * ease(p));
      if (p >= 1) {
        ticker.remove(step);
        resolve();
      }
    };
    ticker.add(step);
  });
}

/** Plain "wait N ms" on the ticker — useful as a stagger between steps. */
export function delay(ticker: Ticker, ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    let elapsed = 0;
    const step = (t: Ticker) => {
      elapsed += t.deltaMS;
      if (elapsed >= ms) {
        ticker.remove(step);
        resolve();
      }
    };
    ticker.add(step);
  });
}
