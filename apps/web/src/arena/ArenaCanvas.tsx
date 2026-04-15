import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Sprite, Text, Texture, Assets } from "pixi.js";
import {
  ARENA,
  buildWedges,
  simulateTrajectory,
  type LobbySnapshot,
  type RoundResult,
  type Wedge,
} from "@conetic/shared";
import { colorForUser, fadeColor } from "./colors";
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
  wedgeContainer: Container;   // wedge fills (bottom layer)
  avatarContainer: Container;  // avatars on top of wedges
  ballContainer: Container;
  overlayContainer: Container;
  wedges: Wedge[];
  ballGraphic: Graphics;
  winnerOverlay: Container | null;
  rafId: number | null;
  rafZoom: number | null;
  /** Increments on every snapshot render — late-arriving avatar loads check this and bail. */
  renderEpoch: number;
}

export function ArenaCanvas({ snapshot, trajectorySeed, liveStartedAt, result, currentUserId }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const stateRef = useRef<ArenaState | null>(null);

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
        // Order: wedges bottom, avatars above wedges, ball above avatars, overlay (zoom + winner) on top
        app.stage.addChild(wedgeContainer, avatarContainer, ballContainer, overlayContainer);

        const ballGraphic = new Graphics();
        ballGraphic.circle(0, 0, ARENA.BALL_RADIUS * PIX_PER_UNIT).fill(0xffffff);
        ballGraphic.visible = false;
        ballContainer.addChild(ballGraphic);

        stateRef.current = {
          wedgeContainer,
          avatarContainer,
          ballContainer,
          overlayContainer,
          wedges: [],
          ballGraphic,
          winnerOverlay: null,
          rafId: null,
          rafZoom: null,
          renderEpoch: 0,
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

  // Redraw wedges whenever players or pot change.
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !snapshot) return;
    try {
      const players = snapshot.players;
      const potNano = BigInt(snapshot.potNano);

      st.renderEpoch++;
      const myEpoch = st.renderEpoch;

      if (players.length === 0 || potNano === 0n) {
        st.wedgeContainer.removeChildren();
        st.avatarContainer.removeChildren();
        st.wedges = [];
        st.ballGraphic.visible = false;
        clearOverlay(st);
        st.wedgeContainer.scale.set(1);
        st.wedgeContainer.position.set(PIX_PER_UNIT, PIX_PER_UNIT);
        st.avatarContainer.scale.set(1);
        st.avatarContainer.position.set(PIX_PER_UNIT, PIX_PER_UNIT);
        return;
      }

      const wedges = buildWedges(players, potNano);
      st.wedges = wedges;
      st.wedgeContainer.removeChildren();
      st.avatarContainer.removeChildren();
      st.wedgeContainer.scale.set(1);
      st.wedgeContainer.position.set(PIX_PER_UNIT, PIX_PER_UNIT);
      st.avatarContainer.scale.set(1);
      st.avatarContainer.position.set(PIX_PER_UNIT, PIX_PER_UNIT);

      // Pass 1: draw all wedge fills.
      for (const w of wedges) {
        const color = colorForUser(w.userId);
        const g = new Graphics();
        g.poly(w.polygon.map((pt) => ({ x: pt.x * PIX_PER_UNIT, y: pt.y * PIX_PER_UNIT })));
        g.fill({ color, alpha: 0.92 });
        g.stroke({ color: 0x0d0d0d, width: 2, alpha: 1 });
        st.wedgeContainer.addChild(g);
      }
      // Pass 2: place avatars in their own top container so they're never covered.
      for (const w of wedges) {
        const player = players.find((p) => p.userId === w.userId);
        if (!player) continue;
        const color = colorForUser(w.userId);
        placeAvatar(st, w, player, color, myEpoch).catch((e) => console.warn("[arena] avatar failed", e));
      }
    } catch (err) {
      console.error("[arena] wedge render failed", err);
    }
  }, [snapshot]);

  // Live trajectory animation.
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !trajectorySeed || liveStartedAt == null) return;
    let traj;
    try {
      traj = simulateTrajectory(trajectorySeed);
    } catch (err) {
      console.error("[arena] simulate failed", err);
      return;
    }
    clearOverlay(st);
    st.wedgeContainer.scale.set(1);
    st.wedgeContainer.position.set(PIX_PER_UNIT, PIX_PER_UNIT);

    st.ballGraphic.visible = true;
    if (st.rafId) cancelAnimationFrame(st.rafId);
    const startWall = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startWall;
      const idx = Math.min(traj.steps.length - 1, Math.floor(elapsed / ARENA.SIM_DT_MS));
      const step = traj.steps[idx]!;
      st.ballGraphic.position.set(step.x * PIX_PER_UNIT, step.y * PIX_PER_UNIT);
      if (idx >= traj.steps.length - 1) {
        st.rafId = null;
        return;
      }
      st.rafId = requestAnimationFrame(animate);
    };
    st.rafId = requestAnimationFrame(animate);

    return () => {
      if (st.rafId) cancelAnimationFrame(st.rafId);
    };
  }, [trajectorySeed, liveStartedAt]);

  // Winner reveal + zoom.
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !result || !snapshot) return;
    const winner = st.wedges.find((w) => w.userId === result.winnerUserId);
    if (!winner) return;

    if (result.winnerUserId === currentUserId) notify("success");

    const wPlayer = snapshot.players.find((p) => p.userId === result.winnerUserId);
    const username = wPlayer?.username ? `@${wPlayer.username}` : wPlayer?.firstName ?? "Winner";

    const t = setTimeout(() => {
      st.ballGraphic.visible = false;
      showWinnerOverlay(st, winner, username);
    }, 400);
    return () => clearTimeout(t);
  }, [result, snapshot, currentUserId]);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}

async function placeAvatar(
  st: ArenaState,
  wedge: Wedge,
  player: { firstName: string; photoUrl: string | null; username: string | null },
  color: number,
  epoch: number,
) {
  // Bail if a newer snapshot has already replaced the wedges.
  if (epoch !== st.renderEpoch) return;

  const cx = wedge.centroid.x * PIX_PER_UNIT;
  const cy = wedge.centroid.y * PIX_PER_UNIT;
  const sizePx = Math.min(64, Math.max(34, wedge.fraction * 260));

  const container = new Container();
  container.position.set(cx, cy);

  // Background circle (initials fallback) — always visible, ensures avatar never looks "missing"
  const bg = new Graphics();
  bg.circle(0, 0, sizePx / 2).fill(0xffffff);
  bg.stroke({ color: 0x0d0d0d, width: 2, alpha: 1 });
  container.addChild(bg);

  const initials = (player.firstName ?? "?").slice(0, 2).toUpperCase();
  const text = new Text({
    text: initials,
    style: {
      fontSize: sizePx * 0.4,
      fontWeight: "700",
      fill: color,
      align: "center",
    },
  });
  text.anchor.set(0.5);
  container.addChild(text);

  // Add to avatar layer immediately (with initials), so it's visible even if photo fails.
  if (epoch === st.renderEpoch) st.avatarContainer.addChild(container);

  if (player.photoUrl) {
    try {
      const tex = (await Assets.load(player.photoUrl)) as Texture;
      if (epoch !== st.renderEpoch) return; // discarded by next render
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
    } catch {
      // initials fallback already shown
    }
  }
}

function showWinnerOverlay(st: ArenaState, winner: Wedge, username: string) {
  clearOverlay(st);
  const overlay = new Container();
  st.overlayContainer.addChild(overlay);

  const dim = new Graphics();
  dim
    .rect(-PIX_PER_UNIT, -PIX_PER_UNIT, PIX_PER_UNIT * 2, PIX_PER_UNIT * 2)
    .fill({ color: 0x000000, alpha: 0.55 });
  overlay.addChild(dim);

  const winText = new Text({
    text: username,
    style: {
      fontSize: 28,
      fontWeight: "800",
      fill: 0xffffff,
      align: "center",
      stroke: { color: 0x000000, width: 4 },
    },
  });
  winText.anchor.set(0.5);
  winText.position.set(0, 0);
  winText.alpha = 0;
  overlay.addChild(winText);

  const targetX = -winner.centroid.x * PIX_PER_UNIT;
  const targetY = -winner.centroid.y * PIX_PER_UNIT;
  const start = performance.now();
  const DUR = 900;

  const animate = () => {
    const t = Math.min(1, (performance.now() - start) / DUR);
    const eased = 1 - Math.pow(1 - t, 3);
    const scale = 1 + eased * 0.6;
    for (const c of [st.wedgeContainer, st.avatarContainer]) {
      c.scale.set(scale);
      c.position.set(PIX_PER_UNIT + targetX * eased, PIX_PER_UNIT + targetY * eased);
    }
    winText.alpha = eased;
    if (t < 1) st.rafZoom = requestAnimationFrame(animate);
    else st.rafZoom = null;
  };
  st.rafZoom = requestAnimationFrame(animate);
  st.winnerOverlay = overlay;

  setTimeout(() => {
    if (st.winnerOverlay === overlay) {
      for (const c of [st.wedgeContainer, st.avatarContainer]) {
        c.scale.set(1);
        c.position.set(PIX_PER_UNIT, PIX_PER_UNIT);
      }
      clearOverlay(st);
    }
  }, 3000);
}

function clearOverlay(st: ArenaState) {
  if (st.winnerOverlay) {
    st.overlayContainer.removeChild(st.winnerOverlay);
    st.winnerOverlay = null;
  }
}
