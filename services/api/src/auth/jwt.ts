import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface SessionPayload {
  sub: string;     // user id
  tgId: number;
  username: string | null;
}

const TTL = "7d";

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: TTL, algorithm: "HS256" });
}

export function verifySession(token: string): SessionPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
  if (typeof decoded !== "object" || decoded === null) throw new Error("bad token");
  return decoded as SessionPayload;
}
