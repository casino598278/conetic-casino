import { Server } from "socket.io";
import type { FastifyInstance } from "fastify";
import { SERVER_EVENTS } from "@conetic/shared";
import { engine } from "../game/engine.js";
import { verifySession } from "../auth/jwt.js";
import { getBalanceNano } from "../db/repo/ledger.js";

let ioInstance: Server | null = null;

export function attachGateway(fastify: FastifyInstance): Server {
  const io = new Server(fastify.server, {
    path: "/socket.io",
    // Permissive CORS — auth is enforced via JWT on handshake (below).
    cors: { origin: true, credentials: true },
  });
  ioInstance = io;

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("missing token"));
    try {
      const session = verifySession(token);
      (socket.data as any).session = session;
      next();
    } catch {
      next(new Error("invalid token"));
    }
  });

  // Max 10 connections per IP to prevent WS flood.
  const connPerIp = new Map<string, number>();
  const MAX_CONN_PER_IP = 10;

  io.on("connection", (socket) => {
    const ip = socket.handshake.address ?? "unknown";
    const cur = connPerIp.get(ip) ?? 0;
    if (cur >= MAX_CONN_PER_IP) {
      socket.disconnect(true);
      return;
    }
    connPerIp.set(ip, cur + 1);
    socket.on("disconnect", () => {
      const n = (connPerIp.get(ip) ?? 1) - 1;
      if (n <= 0) connPerIp.delete(ip); else connPerIp.set(ip, n);
    });

    socket.join("lobby:global");
    const session = (socket.data as any).session;
    if (session?.sub) {
      socket.join(`user:${session.sub}`);
      // Push their current balance immediately on connect.
      try {
        const bal = getBalanceNano(session.sub);
        socket.emit("balance:update", { balanceNano: bal.toString() });
      } catch {
        /* ignore */
      }
    }
    socket.emit(SERVER_EVENTS.LobbyState, engine.getSnapshot());
  });

  // Engine → broadcast
  engine.on("snapshot", (snap) => io.to("lobby:global").emit(SERVER_EVENTS.LobbyState, snap));
  engine.on("playerJoined", (snap) => io.to("lobby:global").emit(SERVER_EVENTS.PlayerJoined, { snapshot: snap }));
  engine.on("tickLite", (e: { countdownEndsAt: number | null }) =>
    io.to("lobby:global").emit(SERVER_EVENTS.LobbyTick, { countdownEndsAt: e.countdownEndsAt }),
  );
  engine.on("roundCommit", (e) => io.to("lobby:global").emit(SERVER_EVENTS.RoundCommit, e));
  engine.on("roundLive", (e) => io.to("lobby:global").emit(SERVER_EVENTS.RoundLive, e));
  engine.on("roundResult", (e) => io.to("lobby:global").emit(SERVER_EVENTS.RoundResult, e));
  engine.on("balanceChanged", (e: { userId: string; balanceNano: bigint }) => {
    io.to(`user:${e.userId}`).emit("balance:update", { balanceNano: e.balanceNano.toString() });
  });

  return io;
}

/** Push an updated balance to a single user's connected sockets. */
export function pushBalance(userId: string, balanceNano: bigint) {
  if (!ioInstance) return;
  ioInstance.to(`user:${userId}`).emit("balance:update", {
    balanceNano: balanceNano.toString(),
  });
}
