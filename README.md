# Conetic Casino

Telegram Mini App — FFA wedge-wager arena. Players stake TON, each gets a wedge proportional to their share of the pot, a ball spawns and bounces until it lands inside someone's wedge — winner takes the pot minus 0.5% house rake.

**Stack**: React + Vite + PixiJS · Node + Fastify + Socket.IO · better-sqlite3 · TON (testnet first) · grammY bot · pnpm workspaces.

## Quick start

```bash
pnpm install

# 1. Generate a TON hot wallet (testnet)
pnpm exec tsx infra/scripts/gen-hot-wallet.ts

# 2. Copy .env.example to .env, fill in:
#    BOT_TOKEN  — from @BotFather
#    JWT_SECRET — long random string
#    HOT_WALLET_MNEMONIC — from the script above
#    PUBLIC_WEB_URL — your ngrok HTTPS URL
cp .env.example .env

# 3. Run all services
pnpm dev
# api  → http://localhost:3000
# web  → http://localhost:5173
# bot  → polling

# 4. Expose web for Telegram
ngrok http 5173
# Set Mini App URL in BotFather → /setmenubutton
```

### Multi-player testing without two phones

The dev server accepts `?devUser=N&devName=Alice` to bypass Telegram auth. Open the Vite URL in two browser tabs with different `devUser` values to simulate multiple players.

### Provably-fair

Every round publishes `serverSeedHash` *before* anyone bets. After the round, the `serverSeed` is revealed in the result event and you can verify it from the **Verify** tab — the computation runs entirely in your browser using the shared algorithm in [packages/shared/src/fair.ts](packages/shared/src/fair.ts).

### Multi-chain readiness

The wallet layer goes through [services/api/src/wallet/chain.ts](services/api/src/wallet/chain.ts). Adding SOL or BTC = new adapter, no game-engine changes.

### Project layout

See the implementation plan at `~/.claude/plans/zazzy-waddling-pebble.md`.
