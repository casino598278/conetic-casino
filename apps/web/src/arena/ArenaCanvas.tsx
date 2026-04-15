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
  wedgeContainer: Container;
  ballContainer: Container;
  overlayContainer: Container;
  wedges: Wedge[];
  ballGraphic: Graphics;
  winnerOverlay: Container | null;
  rafId: number | null;
  rafZoom: number | null;
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
        background: 0x141826,
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
        const ballContainer = new Container();
        const overlayContainer = new Container();
        wedgeContainer.position.set(PIX_PER_UNIT, PIX_PER_UNIT);
        ballContainer.position.set(PIX_PER_UNIT, PIX_PER_UNIT);
        overlayContainer.position.set(PIX_PER_UNIT, PIX_PER_UNIT);
        app.stage.addChild(wedgeContainer, ballContainer, overlayContainer);

        const ballGraphic = new Graphics();
        ballGraphic.circle(0, 0, ARENA.BALL_RADIUS * PIX_PER_UNIT).fill(0xffffff);
        ballGraphic.visible = false;
        ballContainer.addChild(ballGraphic);

        stateRef.current = {
          wedgeContainer,
          ballContainer,
          overlayContainer,
          wedges: [],
          ballGraphic,
          winnerOverlay: null,
          rafId: null,
          rafZoom: null,
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
    const players = snapshot.players;
    const potNano = BigInt(snapshot.potNano);

    if (players.length === 0 || potNano === 0n) {
      st.wedgeContainer.removeChildren();
      st.wedges = [];
      st.ballGraphic.visible = false;
      clearOverlay(st);
      st.wedgeContainer.scale.set(1);
      st.wedgeContainer.position.set(PIX_PER_UNIT, PIX_PER_UNIT);
      return;
    }

    const wedges = buildWedges(players, potNano);
    st.wedges = wedges;
    st.wedgeContainer.removeChildren();
    st.wedgeContainer.scale.set(1);
    st.wedgeContainer.position.set(PIX_PER_UNIT, PIX_PER_UNIT);

    for (const w of wedges) {
      const player = players.find((p) => p.userId === w.userId)!;
      const color = colorForUser(w.userId);
      const g = new Graphics();
      g.poly(w.polygon.map((pt) => ({ x: pt.x * PIX_PER_UNIT, y: pt.y * PIX_PER_UNIT })));
      g.fill({ color, alpha: 0.9 });
      g.stroke({ color: fadeColor(color, 1.2), width: 1, alpha: 0.6 });
      st.wedgeContainer.addChild(g);

      placeAvatar(st, w, player, color).catch(() => {});
    }
  }, [snapshot]);

  // Live trajectory animation.
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !trajectorySeed || liveStartedAt == null) return;
    clearOverlay(st);
    st.wedgeContainer.scale.set(1);
    st.wedgeContainer.position.set(PIX_PER_UNIT, PIX_PER_UNIT);

    const traj = simulateTrajectory(trajectorySeed);
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
) {
  const cx = wedge.centroid.x * PIX_PER_UNIT;
  const cy = wedge.centroid.y * PIX_PER_UNIT;
  const sizePx = Math.min(56, Math.max(28, wedge.fraction * 240));

  const container = new Container();
  container.position.set(cx, cy);
  st.wedgeContainer.addChild(container);

  const bg = new Graphics();
  bg.circle(0, 0, sizePx / 2).fill(0xffffff);
  bg.stroke({ color: 0xffffff, width: 2, alpha: 0.8 });
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

  if (player.photoUrl) {
    try {
      const tex = (await Assets.load(player.photoUrl)) as Texture;
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
      // initials fallback already drawn
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
    st.wedgeContainer.scale.set(scale);
    st.wedgeContainer.position.set(
      PIX_PER_UNIT + targetX * eased,
      PIX_PER_UNIT + targetY * eased,
    );
    winText.alpha = eased;
    if (t < 1) st.rafZoom = requestAnimationFrame(animate);
    else st.rafZoom = null;
  };
  st.rafZoom = requestAnimationFrame(animate);
  st.winnerOverlay = overlay;

  setTimeout(() => {
    if (st.winnerOverlay === overlay) {
      st.wedgeContainer.scale.set(1);
      st.wedgeContainer.position.set(PIX_PER_UNIT, PIX_PER_UNIT);
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
