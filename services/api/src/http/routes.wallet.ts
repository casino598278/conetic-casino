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
  markWithdrawalSent,
  markWithdrawalFailed,
} from "../db/repo/wallet.js";
import { getAdapter } from "../wallet/registry.js";
import { getHotWalletAddressString } from "../wallet/ton/tonAdapter.js";
import { txn } from "../db/sqlite.js";
import { notifyUser } from "../bot.js";
import { pushBalance } from "../ws/gateway.js";
import { ADMIN_TG_ID, ADMIN_APPROVAL_THRESHOLD_NANO } from "../admin/constants.js";
const WITHDRAW_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes between withdrawals
const lastWithdrawTime = new Map<string, number>();

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

    // 3-minute cooldown between withdrawals.
    const lastTime = lastWithdrawTime.get(userId) ?? 0;
    const elapsed = Date.now() - lastTime;
    if (elapsed < WITHDRAW_COOLDOWN_MS) {
      const waitSec = Math.ceil((WITHDRAW_COOLDOWN_MS - elapsed) / 1000);
      return reply.code(429).send({ error: `wait ${waitSec}s before next withdrawal` });
    }
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

      // Record cooldown timestamp + push balance immediately after debit.
      lastWithdrawTime.set(userId, Date.now());
      pushBalance(userId, getBalanceNano(userId));

      // Large withdrawals (>=50 TON) need admin approval.
      if (amountNano >= ADMIN_APPROVAL_THRESHOLD_NANO) {
        const user = getUserById(userId);
        const uname = user?.username ? `@${user.username}` : user?.first_name ?? userId;
        notifyUser(
          ADMIN_TG_ID,
          `Withdrawal request: ${Number(amountNano) / 1e9} TON by ${uname}\nID: ${id}\nApprove: /approve_${id.slice(0, 8)}\nDecline: /decline_${id.slice(0, 8)}`,
        ).catch(() => {});
        return reply.send(WithdrawResponse.parse({ withdrawalId: id, status: "pending" }));
      }

      // Small withdrawals: send immediately (don't wait for cron tick).
      try {
        const { txHash } = await adapter.sendWithdrawal({
          to: parsed.data.toAddress,
          amountNano,
          idempotencyKey,
        });
        markWithdrawalSent(id, txHash);
        // Push updated balance
        const newBal = getBalanceNano(userId);
        pushBalance(userId, newBal);
        const user = getUserById(userId);
        if (user) {
          notifyUser(user.tg_id, `Withdrawal sent: ${Number(amountNano) / 1e9} TON`).catch(() => {});
        }
        return reply.send(WithdrawResponse.parse({ withdrawalId: id, status: "sent" }));
      } catch (sendErr: any) {
        // If send fails, leave it as pending for the cron to retry.
        console.error("[withdraw] immediate send failed, will retry:", sendErr?.message);
        return reply.send(WithdrawResponse.parse({ withdrawalId: id, status: "pending" }));
      }
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
