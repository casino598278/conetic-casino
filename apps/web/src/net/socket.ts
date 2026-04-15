import { io, type Socket } from "socket.io-client";
import { clearToken, getToken } from "./api";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io({
    path: "/socket.io",
    auth: (cb) => cb({ token: getToken() }),
    autoConnect: true,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });

  socket.on("connect", () => {
    console.log("[socket] connected", socket?.id);
  });

  socket.on("connect_error", (err) => {
    console.warn("[socket] connect_error:", err.message);
    if (err.message === "invalid token" || err.message === "missing token") {
      // Token died — wipe and force a fresh login on next page load.
      clearToken();
      // Soft reload after 1s to re-auth via Telegram initData.
      setTimeout(() => window.location.reload(), 1000);
    }
  });

  socket.on("disconnect", (reason) => {
    console.warn("[socket] disconnected:", reason);
  });

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
