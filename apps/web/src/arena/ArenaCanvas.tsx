import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import {
  ARENA,
  buildWedges,
  simulateTrajectory,
  type LobbySnapshot,
  type RoundResult,
  type Wedge,
} from "@conetic/shared";
import { colorForUser } from "./colors";
import { notify } from "../telegram/initWebApp";

interface Props {
  snapshot: LobbySnapshot | null;
  trajectorySeed: string | null;
  liveStartedAt: number | null;
  result: RoundResult | null;
  currentUserId: string | null;
}

const PIX_PER_UNIT = 180; // logical [-1,1] → 360px

interface ArenaState {
  wedgeContainer: Container;     // wedge fills (bottom layer)
  avatarContainer: Container;    // avatars on top of wedges
  ballContainer: Container;      // ball + arrow + label
  overlayContainer: Container;   // winner reveal
  wedges: Wedge[];
  ball: Container | null;
  arrow: Graphics | null;
  ballLabel: Text | null;
  winnerOverlay: Container | null;
  waitingText: Text | null;      // "Waiting for players…" placeholder
  rafWaiting: number | null;
  rafSpin: number | null;
  rafZoom: number | null;
  renderEpoch: number;
  lastRoundId: number | null;
}

export function ArenaCanvas({ snapshot, trajectorySeed, liveStartedAt, result, currentUserId }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const stateRef = useRef<ArenaState | null>(null);

  // Mount Pixi once
  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current!;
    const app = new Application();
    app
      .init({
        width: PIX_PER_UNIT * 2,
        height: PIX_PER_UNIT * 2,
        background: 0x161616,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      })
      .then(() => {
        if (cancelled) return;
        host.appendChild(app.canvas);
        app.canvas.style.width = "100%";
        app.canvas.style.height = "100%";
        app.canvas.style.display = "block";

        const wedgeContainer = new Container();
        const avatarContainer = new Container();
        const ballContainer = new Container();
        const overlayContainer = new Container();
        for (const c of [wedgeContainer, avatarContainer, ballContainer, overlayContainer]) {
          c.position.set(PIX_PER_UNIT, PIX_PER_UNIT);
        }
        app.stage.addChild(wedgeContainer, avatarContainer, ballContainer, overlayContainer);

        stateRef.current = {
          wedgeContainer,
          avatarContainer,
          ballContainer,
          overlayContainer,
          wedges: [],
          ball: null,
          arrow: null,
          ballLabel: null,
          winnerOverlay: null,
          waitingText: null,
          rafWaiting: null,
          rafSpin: null,
          rafZoom: null,
          renderEpoch: 0,
          lastRoundId: null,
        };
        appRef.current = app;
      });
    return () => {
      cancelled = true;
      const st = stateRef.current;
      if (st?.rafWaiting) cancelAnimationFrame(st.rafWaiting);
      if (st?.rafSpin) cancelAnimationFrame(st.rafSpin);
      if (st?.rafZoom) cancelAnimationFrame(st.rafZoom);
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
      }
    };
  }, []);

  // Redraw wedges + avatars + ball whenever players change
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !snapshot) return;
    try {
      const players = snapshot.players;
      const potNano = BigInt(snapshot.potNano);
      st.renderEpoch++;
      const myEpoch = st.renderEpoch;
      const newRound = snapshot.roundId !== st.lastRoundId;
      st.lastRoundId = snapshot.roundId;

      if (newRound) {
        if (st.rafSpin) { cancelAnimationFrame(st.rafSpin); st.rafSpin = null; }
        if (st.rafZoom) { cancelAnimationFrame(st.rafZoom); st.rafZoom = null; }
        clearOverlay(st);
        for (const c of [st.wedgeContainer, st.avatarContainer, st.ballContainer]) {
          c.scale.set(1);
          c.position.set(PIX_PER_UNIT, PIX_PER_UNIT);
          c.alpha = 1;
        }
        // Hide ball + reset its local transforms for the next spin.
        if (st.ball) {
          st.ball.visible = false;
          st.ball.position.set(0, 0);
          st.ball.scale.set(0.4);
        }
        if (st.arrow) {
          st.arrow.visible = false;
          st.arrow.alpha = 0;
          st.arrow.rotation = 0;
        }
        if (st.ballLabel) {
          st.ballLabel.visible = false;
          st.ballLabel.text = "";
        }
      }

      if (players.length === 0 || potNano === 0n) {
        stopWaitingPulse(st);
        st.wedgeContainer.removeChildren();
        st.avatarContainer.removeChildren();
        st.ballContainer.removeChildren();
        st.wedges = [];
        st.ball = null;
        st.arrow = null;
        st.ballLabel = null;
        drawEmptyState(st);
        return;
      }
      // Round has players — ensure the waiting pulse is stopped.
      stopWaitingPulse(st);

      const wedges = buildWedges(players, potNano);
      st.wedges = wedges;
      st.wedgeContainer.removeChildren();
      st.avatarContainer.removeChildren();

      // Pass 1: wedge fills. Dominant fills full arena; corners overlay triangles.
      // Render dominant FIRST so corners paint over.
      const dominant = wedges.find((w) => w.corner === -1);
      const corners = wedges.filter((w) => w.corner >= 0);
      if (dominant) {
        const color = colorForUser(dominant.userId);
        const g = new Graphics();
        g.poly(dominant.polygon.map((pt) => ({ x: pt.x * PIX_PER_UNIT, y: pt.y * PIX_PER_UNIT })));
        g.fill({ color, alpha: 0.92 });
        st.wedgeContainer.addChild(g);
      }
      for (const w of corners) {
        const color = colorForUser(w.userId);
        const g = new Graphics();
        g.poly(w.polygon.map((pt) => ({ x: pt.x * PIX_PER_UNIT, y: pt.y * PIX_PER_UNIT })));
        g.fill({ color, alpha: 0.95 });
        st.wedgeContainer.addChild(g);
      }

      // Pass 2: avatars (larger now — focus of UI)
      for (const w of wedges) {
        const player = players.find((p) => p.userId === w.userId);
        if (!player) continue;
        placeAvatar(st, w, player, myEpoch).catch(() => {});
      }

      // Pass 3: centre ball + pointer (created if missing, persistent across snapshots)
      ensureBall(st);
    } catch (err) {
      console.error("[arena] render failed", err);
    }
  }, [snapshot]);

  // Spin → Shoot animation
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !trajectorySeed || liveStartedAt == null) return;
    let traj;
    try { traj = simulateTrajectory(trajectorySeed); } catch (err) { console.error(err); return; }
    clearOverlay(st);
    ensureBall(st);

    const stepsPx = traj.steps.map((s) => ({
      phase: s.phase,
      x: s.x * PIX_PER_UNIT,
      y: s.y * PIX_PER_UNIT,
      angle: s.angle,
      t: s.t,
    }));

    if (st.ball) {
      st.ball.position.set(0, 0);
      st.ball.visible = true;
      st.ball.scale.set(0.4);
    }
    if (st.arrow) {
      st.arrow.position.set(0, 0);
      st.arrow.visible = true;
      st.arrow.alpha = 0;
      st.arrow.rotation = 0;
    }
    if (st.ballLabel) {
      st.ballLabel.visible = false;
      st.ballLabel.text = "";
    }

    if (st.rafSpin) cancelAnimationFrame(st.rafSpin);
    const startWall = performance.now();
    const totalMs = traj.durationMs;
    const POP_IN = 350;

    const animate = () => {
      const elapsed = performance.now() - startWall;
      const idx = Math.min(stepsPx.length - 1, Math.floor(elapsed / ARENA.SIM_DT_MS));
      const step = stepsPx[idx]!;

      // Ball pop-in
      if (st.ball) {
        st.ball.position.set(step.x, step.y);
        if (elapsed < POP_IN) {
          const t = elapsed / POP_IN;
          st.ball.scale.set(0.4 + (1 - Math.pow(1 - t, 3)) * 0.6);
        } else if (st.ball.scale.x < 1) {
          st.ball.scale.set(1);
        }
      }

      // Arrow visible during SPIN; hidden during SHOOT
      if (st.arrow) {
        if (step.phase === "spin") {
          st.arrow.position.set(0, 0);
          st.arrow.rotation = step.angle;
          st.arrow.alpha = Math.min(1, elapsed / POP_IN);
        } else if (st.arrow.visible) {
          st.arrow.visible = false;
        }
      }

      // Username label tracks the moving ball during SHOOT
      if (st.ballLabel) {
        if (step.phase === "shoot") {
          st.ballLabel.visible = true;
          st.ballLabel.position.set(step.x, step.y - (ARENA.BALL_RADIUS * PIX_PER_UNIT + 12));
          const wedge = wedgeAt(st.wedges, step);
          if (wedge && snapshot) {
            const player = snapshot.players.find((p) => p.userId === wedge.userId);
            const name = player?.username ? `@${player.username}` : player?.firstName ?? "";
            if (st.ballLabel.text !== name) st.ballLabel.text = name;
          }
        } else {
          st.ballLabel.visible = false;
        }
      }

      // Gentle camera zoom on ball during the last 35% of the SHOOT phase
      const zoomStart = totalMs * 0.65;
      if (elapsed >= zoomStart && step.phase === "shoot") {
        const z = Math.min(1, (elapsed - zoomStart) / Math.max(1, totalMs - zoomStart));
        const eased = 1 - Math.pow(1 - z, 3);
        const scale = 1 + eased * 0.45;
        const tx = -step.x * eased;
        const ty = -step.y * eased;
        for (const c of [st.wedgeContainer, st.avatarContainer, st.ballContainer]) {
          c.scale.set(scale);
          c.position.set(PIX_PER_UNIT + tx * scale, PIX_PER_UNIT + ty * scale);
        }
      }

      if (idx >= stepsPx.length - 1) { st.rafSpin = null; return; }
      st.rafSpin = requestAnimationFrame(animate);
    };
    st.rafSpin = requestAnimationFrame(animate);

    return () => {
      if (st.rafSpin) cancelAnimationFrame(st.rafSpin);
    };
  }, [trajectorySeed, liveStartedAt, snapshot]);

  // Winner reveal
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !result || !snapshot) return;
    const winner = st.wedges.find((w) => w.userId === result.winnerUserId);
    if (!winner) return;
    if (result.winnerUserId === currentUserId) notify("success");

    const wPlayer = snapshot.players.find((p) => p.userId === result.winnerUserId);
    const username = wPlayer?.username ? `@${wPlayer.username}` : wPlayer?.firstName ?? "Winner";

    const t = setTimeout(() => {
      showWinnerReveal(st, winner, username, wPlayer?.photoUrl ?? null);
    }, 300);
    return () => {
      clearTimeout(t);
      if (st.rafZoom) { cancelAnimationFrame(st.rafZoom); st.rafZoom = null; }
      clearOverlay(st);
      for (const c of [st.wedgeContainer, st.avatarContainer, st.ballContainer]) {
        c.scale.set(1);
        c.position.set(PIX_PER_UNIT, PIX_PER_UNIT);
        c.alpha = 1;
      }
    };
  }, [result, snapshot, currentUserId]);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}

// ---------------- helpers ----------------

function ensureBall(st: ArenaState) {
  if (st.ball) return;
  st.ballContainer.removeChildren();

  const ball = new Container();
  const r = ARENA.BALL_RADIUS * PIX_PER_UNIT;

  // Outer glow
  const glow = new Graphics();
  glow.circle(0, 0, r * 1.7).fill({ color: 0xffffff, alpha: 0.16 });
  glow.circle(0, 0, r * 1.3).fill({ color: 0xffffff, alpha: 0.28 });
  ball.addChild(glow);

  // White core
  const core = new Graphics();
  core.circle(0, 0, r).fill({ color: 0xffffff });
  ball.addChild(core);

  // Subtle red highlight inside (Portals look)
  const hi = new Graphics();
  hi.circle(0, 0, r * 0.55).fill({ color: 0xff5050, alpha: 0.5 });
  ball.addChild(hi);

  ball.visible = false;
  st.ballContainer.addChild(ball);

  // Aiming arrow that rotates around the centre during SPIN phase
  const arrow = new Graphics();
  const len = r * 1.8;
  arrow
    .moveTo(r * 1.1, 0)
    .lineTo(r * 1.1 + len, 0)
    .stroke({ color: 0xffffff, width: 4, cap: "round" });
  // Arrowhead
  const tipX = r * 1.1 + len;
  arrow
    .moveTo(tipX, 0)
    .lineTo(tipX - 8, -6)
    .lineTo(tipX - 8, 6)
    .closePath()
    .fill({ color: 0xffffff });
  arrow.visible = false;
  st.ballContainer.addChild(arrow);

  // Username label above the ball during SHOOT phase
  const label = new Text({
    text: "",
    style: {
      fontSize: 14,
      fontWeight: "700",
      fill: 0xffffff,
      align: "center",
      stroke: { color: 0x000000, width: 4 },
    },
  });
  label.anchor.set(0.5, 1);
  label.visible = false;
  st.ballContainer.addChild(label);

  st.ball = ball;
  st.arrow = arrow;
  st.ballLabel = label;
}

async function placeAvatar(
  st: ArenaState,
  wedge: Wedge,
  player: { firstName: string; photoUrl: string | null; username: string | null },
  epoch: number,
) {
  if (epoch !== st.renderEpoch) return;
  const cx = wedge.centroid.x * PIX_PER_UNIT;
  const cy = wedge.centroid.y * PIX_PER_UNIT;
  // Size strategy:
  //   - dominant (corner === -1): big centred avatar, scaled by their share
  //   - corner triangles: avatar fits inside the inscribed circle of the right triangle
  let sizePx: number;
  if (wedge.corner === -1) {
    sizePx = Math.min(180, Math.max(90, Math.sqrt(wedge.fraction) * 210));
  } else {
    // Triangle legs s = sqrt(8*f) * HALF (in logical units) → pixels.
    const triSidePx = Math.sqrt(8 * wedge.fraction) * ARENA.HALF_SIDE * PIX_PER_UNIT;
    // Inscribed-circle diameter = 2 * s * (1 - 1/sqrt(2)) ≈ 0.586 * s
    // Use 80% of the inscribed diameter for safe margin from triangle edges.
    const inscribedDiameter = triSidePx * (2 - Math.SQRT2);
    sizePx = Math.min(70, Math.max(14, inscribedDiameter * 0.8));
  }

  const container = new Container();
  container.position.set(cx, cy);

  const bg = new Graphics();
  bg.circle(0, 0, sizePx / 2).fill(0xffffff);
  bg.stroke({ color: 0xffffff, width: 3, alpha: 0.95 });
  container.addChild(bg);

  const initials = (player.firstName ?? "?").slice(0, 2).toUpperCase();
  const text = new Text({
    text: initials,
    style: {
      fontSize: sizePx * 0.4,
      fontWeight: "800",
      fill: colorForUser(wedge.userId),
      align: "center",
    },
  });
  text.anchor.set(0.5);
  container.addChild(text);

  if (epoch === st.renderEpoch) st.avatarContainer.addChild(container);

  if (player.photoUrl) {
    try {
      const proxied = `/api/avatar?url=${encodeURIComponent(player.photoUrl)}`;
      // Bypass Pixi Assets.load (it doesn't sniff query-string URLs reliably).
      // Load via Image → Texture so the mime is determined by the response, not the URL.
      const img = await loadImageBitmap(proxied);
      if (epoch !== st.renderEpoch) return;
      const tex = Texture.from(img);
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.width = sizePx;
      sprite.height = sizePx;
      const mask = new Graphics();
      mask.circle(0, 0, sizePx / 2).fill(0xffffff);
      container.addChild(mask);
      sprite.mask = mask;
      container.addChild(sprite);
      text.visible = false;
    } catch (err) {
      console.warn("[arena] avatar load failed for", player.photoUrl, err);
    }
  }
}

function loadImageBitmap(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function showWinnerReveal(st: ArenaState, winner: Wedge, _username: string, _photoUrl: string | null) {
  clearOverlay(st);

  // Capture current zoomed-in transform (ended up near the ball).
  const startScale = st.wedgeContainer.scale.x;
  const startX = st.wedgeContainer.position.x;
  const startY = st.wedgeContainer.position.y;

  // Final transform: focus on winner's wedge centroid at slightly higher scale.
  const finalScale = Math.max(startScale, 2.0);
  const targetX = -winner.centroid.x * PIX_PER_UNIT;
  const targetY = -winner.centroid.y * PIX_PER_UNIT;
  const finalX = PIX_PER_UNIT + targetX * finalScale;
  const finalY = PIX_PER_UNIT + targetY * finalScale;

  const start = performance.now();
  const DUR = 700;

  const animate = () => {
    const t = Math.min(1, (performance.now() - start) / DUR);
    const eased = 1 - Math.pow(1 - t, 3);
    const scale = startScale + (finalScale - startScale) * eased;
    const x = startX + (finalX - startX) * eased;
    const y = startY + (finalY - startY) * eased;
    for (const c of [st.wedgeContainer, st.avatarContainer, st.ballContainer]) {
      c.scale.set(scale);
      c.position.set(x, y);
    }
    st.ballContainer.alpha = 1 - eased;
    if (t < 1) st.rafZoom = requestAnimationFrame(animate);
    else st.rafZoom = null;
  };
  st.rafZoom = requestAnimationFrame(animate);

  // Reset for next round after the reveal display time.
  setTimeout(() => {
    for (const c of [st.wedgeContainer, st.avatarContainer, st.ballContainer]) {
      c.scale.set(1);
      c.position.set(PIX_PER_UNIT, PIX_PER_UNIT);
    }
    st.ballContainer.alpha = 1;
    clearOverlay(st);
  }, 3500);
}

function clearOverlay(st: ArenaState) {
  if (st.winnerOverlay) {
    st.overlayContainer.removeChild(st.winnerOverlay);
    st.winnerOverlay = null;
  }
}

/** Draw a subtle grid + pulsing "Waiting for players…" text when no round is active. */
function drawEmptyState(st: ArenaState) {
  const GRID_STEP = 30;
  const ALPHA = 0.08;
  const side = PIX_PER_UNIT;

  const g = new Graphics();
  for (let x = -side; x <= side; x += GRID_STEP) g.moveTo(x, -side).lineTo(x, side);
  for (let y = -side; y <= side; y += GRID_STEP) g.moveTo(-side, y).lineTo(side, y);
  g.stroke({ color: 0xffffff, width: 1, alpha: ALPHA });
  st.wedgeContainer.addChild(g);

  const text = new Text({
    text: "Waiting for players…",
    style: {
      fontSize: 18,
      fontWeight: "600",
      fill: 0x787878,
      align: "center",
    },
  });
  text.anchor.set(0.5);
  text.position.set(0, 0);
  st.wedgeContainer.addChild(text);
  st.waitingText = text;

  // Pulse: 2s cycle, scale 0.95 → 1.05, alpha 0.55 → 1.0
  if (st.rafWaiting) cancelAnimationFrame(st.rafWaiting);
  const start = performance.now();
  const loop = () => {
    if (!st.waitingText) { st.rafWaiting = null; return; }
    const t = ((performance.now() - start) / 2000) % 1; // 0..1
    const phase = (Math.sin(t * Math.PI * 2) + 1) / 2;   // 0..1..0
    const scale = 0.96 + phase * 0.08;                   // 0.96 → 1.04
    const alpha = 0.55 + phase * 0.45;                   // 0.55 → 1.0
    st.waitingText.scale.set(scale);
    st.waitingText.alpha = alpha;
    st.rafWaiting = requestAnimationFrame(loop);
  };
  st.rafWaiting = requestAnimationFrame(loop);
}

/** Stop the waiting-text pulse (called when wedges take over). */
function stopWaitingPulse(st: ArenaState) {
  if (st.rafWaiting) {
    cancelAnimationFrame(st.rafWaiting);
    st.rafWaiting = null;
  }
  st.waitingText = null;
}

/** Find the wedge whose polygon contains the ball's pixel position. */
function wedgeAt(wedges: Wedge[], step: { x: number; y: number }): Wedge | null {
  if (wedges.length === 0) return null;
  if (wedges.length === 1) return wedges[0]!;
  const x = step.x / PIX_PER_UNIT;
  const y = step.y / PIX_PER_UNIT;
  // Prefer a corner triangle if the point is inside one.
  for (const w of wedges) {
    if (w.corner >= 0 && pointInPolygon({ x, y }, w.polygon)) return w;
  }
  // Fall back to the dominant / full-arena wedge.
  return wedges.find((w) => w.corner === -1) ?? wedges[0]!;
}

function pointInPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersect =
      (a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}
