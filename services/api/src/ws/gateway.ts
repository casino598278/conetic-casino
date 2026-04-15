import { Server } from "socket.io";
import type { FastifyInstance } from "fastify";
import { SERVER_EVENTS } from "@conetic/shared";
import { config } from "../config.js";
import { engine } from "../game/engine.js";
import { verifySession } from "../auth/jwt.js";

export function attachGateway(fastify: FastifyInstance): Server {
  const io = new Server(fastify.server, {
    path: "/socket.io",
    // Permissive CORS — auth is enforced via JWT on handshake (below).
    cors: { origin: true, credentials: true },
  });

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

  io.on("connection", (socket) => {
    socket.join("lobby:global");
    socket.emit(SERVER_EVENTS.LobbyState, engine.getSnapshot());
  });

  // Engine → broadcast
  engine.on("snapshot", (snap) => io.to("lobby:global").emit(SERVER_EVENTS.LobbyState, snap));
  engine.on("playerJoined", (snap) => io.to("lobby:global").emit(SERVER_EVENTS.PlayerJoined, { snapshot: snap }));
  engine.on("tick", (snap) =>
    io.to("lobby:global").emit(SERVER_EVENTS.LobbyTick, { countdownEndsAt: snap.countdownEndsAt }),
  );
  engine.on("roundCommit", (e) => io.to("lobby:global").emit(SERVER_EVENTS.RoundCommit, e));
  engine.on("roundLive", (e) => io.to("lobby:global").emit(SERVER_EVENTS.RoundLive, e));
  engine.on("roundResult", (e) => io.to("lobby:global").emit(SERVER_EVENTS.RoundResult, e));

  return io;
}
