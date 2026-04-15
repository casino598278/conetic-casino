import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { verifySession, type SessionPayload } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionPayload;
  }
}

export const requireAuth: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.decorateRequest("user", undefined as unknown as SessionPayload);
  fastify.addHook("preHandler", async (req: FastifyRequest, reply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "missing bearer token" });
    }
    try {
      req.user = verifySession(auth.slice(7));
    } catch {
      return reply.code(401).send({ error: "invalid or expired token" });
    }
  });
};
