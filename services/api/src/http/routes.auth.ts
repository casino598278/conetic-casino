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

    let verified;
    if (config.NODE_ENV === "development" && parsed.data.initData.startsWith("dev:")) {
      // Dev escape hatch — `dev:<tgId>:<firstName>` for browser-based multi-player testing.
      const [, tgIdStr, firstName] = parsed.data.initData.split(":");
      verified = {
        tgId: parseInt(tgIdStr ?? "1000", 10),
        username: `dev${tgIdStr}`,
        firstName: firstName ?? `Dev${tgIdStr}`,
        photoUrl: null,
        authDate: Math.floor(Date.now() / 1000),
        lastName: null,
      };
    } else {
      try {
        verified = verifyInitData(parsed.data.initData, config.BOT_TOKEN);
      } catch (err) {
        if (err instanceof AuthError) return reply.code(401).send({ error: err.message });
        throw err;
      }
    }

    const user = upsertTelegramUser({
      tgId: verified.tgId,
      username: verified.username,
      firstName: verified.firstName,
      photoUrl: verified.photoUrl,
    });

    const token = signSession({
      sub: user.id,
      tgId: user.tg_id,
      username: user.username,
    });

    const body = AuthResponse.parse({
      token,
      user: {
        id: user.id,
        tgId: user.tg_id,
        username: user.username,
        firstName: user.first_name,
        photoUrl: user.photo_url,
      },
    });
    return reply.send(body);
  });
}
