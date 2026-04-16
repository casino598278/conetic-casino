import type { FastifyInstance } from "fastify";
import { AuthRequest, AuthResponse } from "@conetic/shared";
import { config } from "../config.js";
import { upsertTelegramUser } from "../db/repo/users.js";
import { signSession } from "../auth/jwt.js";
import { AuthError, verifyInitData } from "../auth/telegramInitData.js";

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/telegram", async (req, reply) => {
    const parsed = AuthRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad request" });

    // Limit initData size to prevent memory abuse.
    if (parsed.data.initData.length > 4096) {
      return reply.code(400).send({ error: "bad request" });
    }

    let verified;
    try {
      verified = verifyInitData(parsed.data.initData, config.BOT_TOKEN);
    } catch (err) {
      if (err instanceof AuthError) return reply.code(401).send({ error: "invalid credentials" });
      throw err;
    }

    const user = upsertTelegramUser({
      tgId: verified.tgId,
      username: verified.username,
      firstName: verified.firstName?.slice(0, 64) ?? "Player",
      photoUrl: verified.photoUrl,
    });

    const token = signSession({
      sub: user.id,
      tgId: user.tg_id,
      username: user.username,
    });

    return reply.send(
      AuthResponse.parse({
        token,
        user: {
          id: user.id,
          tgId: user.tg_id,
          username: user.username,
          firstName: user.first_name,
          photoUrl: user.photo_url,
        },
      }),
    );
  });
}
