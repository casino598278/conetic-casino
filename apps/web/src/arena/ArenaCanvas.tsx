import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import {
  ARENA,
  buildWedges,
  initSpawnFromSeed,
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
  ballContainer: Container;      // centre ball + pointer
  overlayContainer: Container;   // winner reveal
  wedges: Wedge[];
  ball: Container | null;        // centre ball graphic + glow
  pointer: Graphics | null;      // rotating white arrow
  winnerOverlay: Container | null;
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
          pointer: null,
          winnerOverlay: null,
          rafSpin: null,
          rafZoom: null,
          renderEpoch: 0,
          lastRoundId: null,
        };
        appRef.current = app;
      });
    return () => {
      cancelled = true;
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
        if (st.pointer) {
          st.pointer.alpha = 0;
          st.pointer.position.set(0, 0);
          st.pointer.rotation = 0;
        }
      }

      if (players.length === 0 || potNano === 0n) {
        st.wedgeContainer.removeChildren();
        st.avatarContainer.removeChildren();
        st.ballContainer.removeChildren();
        st.wedges = [];
        st.ball = null;
        st.pointer = null;
        return;
      }

      const wedges = buildWedges(players, potNano);
      st.wedges = wedges;
      st.wedgeContainer.removeChildren();
      st.avatarContainer.removeChildren();

      // Pass 1: wedge fills (no border)
      for (const w of wedges) {
        const color = colorForUser(w.userId);
        const g = new Graphics();
        g.poly(w.polygon.map((pt) => ({ x: pt.x * PIX_PER_UNIT, y: pt.y * PIX_PER_UNIT })));
        g.fill({ color, alpha: 0.96 });
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

  // Run pointer spin animation
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !trajectorySeed || liveStartedAt == null) return;
    let traj;
    try { traj = simulateTrajectory(trajectorySeed); } catch (err) { console.error(err); return; }
    clearOverlay(st);
    ensureBall(st);

    // Place the ball at a deterministic random spawn point inside the arena.
    const spawn = initSpawnFromSeed(trajectorySeed);
    const spawnPx = { x: spawn.x * PIX_PER_UNIT, y: spawn.y * PIX_PER_UNIT };
    if (st.ball) {
      st.ball.position.set(spawnPx.x, spawnPx.y);
      st.ball.visible = false;
      st.ball.scale.set(0.4); // pop in
    }
    if (st.pointer) {
      st.pointer.position.set(spawnPx.x, spawnPx.y);
      st.pointer.alpha = 1;
    }

    if (st.rafSpin) cancelAnimationFrame(st.rafSpin);
    const startWall = performance.now();
    const totalMs = traj.durationMs;
    // Reveal ball during the last ~25% of the spin, zoom toward it during last ~35%.
    const ballRevealAt = totalMs * 0.7;
    const zoomStartAt = totalMs * 0.55;

    const animate = () => {
      const elapsed = performance.now() - startWall;
      const idx = Math.min(traj.steps.length - 1, Math.floor(elapsed / ARENA.SIM_DT_MS));
      const step = traj.steps[idx]!;
      if (st.pointer) st.pointer.rotation = step.angle;

      // Late ball spawn — fades + scales in
      if (st.ball) {
        if (elapsed >= ballRevealAt) {
          st.ball.visible = true;
          const t = Math.min(1, (elapsed - ballRevealAt) / Math.max(1, totalMs - ballRevealAt));
          const eased = 1 - Math.pow(1 - t, 3);
          st.ball.scale.set(0.4 + eased * 0.6); // 0.4 → 1.0
        }
      }

      // Camera zoom toward the ball as spin decelerates.
      if (elapsed >= zoomStartAt) {
        const z = Math.min(1, (elapsed - zoomStartAt) / Math.max(1, totalMs - zoomStartAt));
        const eased = 1 - Math.pow(1 - z, 3);
        const scale = 1 + eased * 0.9;             // 1 → 1.9
        const tx = -spawnPx.x * eased;
        const ty = -spawnPx.y * eased;
        for (const c of [st.wedgeContainer, st.avatarContainer, st.ballContainer]) {
          c.scale.set(scale);
          c.position.set(PIX_PER_UNIT + tx * scale, PIX_PER_UNIT + ty * scale);
        }
      }

      if (idx >= traj.steps.length - 1) { st.rafSpin = null; return; }
      st.rafSpin = requestAnimationFrame(animate);
    };
    st.rafSpin = requestAnimationFrame(animate);

    return () => {
      if (st.rafSpin) cancelAnimationFrame(st.rafSpin);
      // Don't reset transforms here — winner reveal effect handles that.
    };
  }, [trajectorySeed, liveStartedAt]);

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

  // Outer soft white glow
  const glow = new Graphics();
  glow.circle(0, 0, r * 1.7).fill({ color: 0xffffff, alpha: 0.16 });
  glow.circle(0, 0, r * 1.3).fill({ color: 0xffffff, alpha: 0.28 });
  ball.addChild(glow);

  // White core
  const core = new Graphics();
  core.circle(0, 0, r).fill({ color: 0xffffff });
  ball.addChild(core);

  // Subtle red highlight inside the ball (matches Portals reference)
  const highlight = new Graphics();
  highlight.circle(0, 0, r * 0.55).fill({ color: 0xff5050, alpha: 0.55 });
  ball.addChild(highlight);

  // Tiny pointer pip — short tick rotating around the ball at its edge
  const pointer = new Graphics();
  const tickLen = r * 0.9;
  pointer
    .moveTo(r, 0)
    .lineTo(r + tickLen, 0)
    .stroke({ color: 0xffffff, width: 3, cap: "round" });
  pointer.alpha = 0; // hidden until spin starts
  st.ballContainer.addChild(pointer);

  st.ballContainer.addChild(ball);
  ball.visible = false; // hidden until late in the spin
  st.ball = ball;
  st.pointer = pointer;
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
  const sizePx = Math.min(110, Math.max(56, wedge.fraction * 320));

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
