import type { FastifyReply, FastifyRequest } from "fastify";
import { verifySession, type SessionPayload } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionPayload;
  }
}

/**
 * Attach as a per-route `preHandler`. Verifies Bearer JWT and sets req.user.
 * Avoids Fastify plugin/scope/decorator races by being a plain async function.
 */
export async function requireAuthHook(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "missing bearer token" });
  }
  try {
    (req as FastifyRequest & { user: SessionPayload }).user = verifySession(auth.slice(7));
  } catch {
    return reply.code(401).send({ error: "invalid or expired token" });
  }
}
