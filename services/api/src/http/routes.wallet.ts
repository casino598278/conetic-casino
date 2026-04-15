import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  DepositTargetResponse,
  WithdrawRequest,
  WithdrawResponse,
} from "@conetic/shared";
import { config } from "../config.js";
import { requireAuthHook } from "../auth/authPlugin.js";
import { getUserById } from "../db/repo/users.js";
import { debit, getBalanceNano, InsufficientBalanceError } from "../db/repo/ledger.js";
import {
  createWithdrawal,
  dailyWithdrawnNano,
  findWithdrawalByIdempotency,
} from "../db/repo/wallet.js";
import { getAdapter } from "../wallet/registry.js";
import { getHotWalletAddressString } from "../wallet/ton/tonAdapter.js";
import { txn } from "../db/sqlite.js";

export async function registerWalletRoutes(app: FastifyInstance) {
  app.get("/wallet/deposit", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const user = getUserById(req.user.sub);
    if (!user) return reply.code(404).send({ error: "user not found" });
    let address: string;
    try {
      address = await getHotWalletAddressString();
    } catch {
      return reply.code(503).send({ error: "hot wallet not configured" });
    }
    return reply.send(
      DepositTargetResponse.parse({
        chainId: "ton",
        address,
        memo: user.memo,
        network: config.TON_NETWORK,
      }),
    );
  });

  app.post("/wallet/withdraw", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const parsed = WithdrawRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad request" });

    const adapter = getAdapter("ton");
    if (!adapter.validateAddress(parsed.data.toAddress)) {
      return reply.code(400).send({ error: "invalid address" });
    }
    const amountNano = BigInt(parsed.data.amountNano);
    if (amountNano <= 0n) return reply.code(400).send({ error: "amount must be positive" });

    const userId = req.user.sub;
    const dailyCapNano = BigInt(Math.floor(config.MAX_DAILY_WITHDRAW_TON * 1e9));
    const alreadyToday = dailyWithdrawnNano(userId, "ton");
    if (alreadyToday + amountNano > dailyCapNano) {
      return reply.code(429).send({ error: "daily withdrawal cap exceeded" });
    }

    const idempotencyKey = (req.headers["idempotency-key"] as string) ?? randomUUID();
    const dup = findWithdrawalByIdempotency(idempotencyKey);
    if (dup) {
      return reply.send(
        WithdrawResponse.parse({ withdrawalId: dup.id, status: dup.status }),
      );
    }

    const fee = await adapter.estimateFeeNano(amountNano);
    const totalDebit = amountNano + fee;
    try {
      const id = randomUUID();
      txn(() => {
        debit({
          userId,
          amountNano: totalDebit,
          reason: "withdraw",
          refId: id,
        });
        createWithdrawal({
          id,
          chainId: "ton",
          userId,
          toAddress: parsed.data.toAddress,
          amountNano,
          feeNano: fee,
          idempotencyKey,
        });
      });
      return reply.send(WithdrawResponse.parse({ withdrawalId: id, status: "pending" }));
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        return reply.code(402).send({ error: "insufficient balance" });
      }
      throw err;
    }
  });

  app.get("/wallet/balance", { preHandler: requireAuthHook }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const balance = getBalanceNano(req.user.sub);
    return reply.send({ balanceNano: balance.toString() });
  });
}
