# Deployment Setup

Deploying Conetic Casino to Render, wiring it into the Telegram bot, and fixing the most common thing that goes wrong: **auto-deploy silently stops**.

Live service URL: `https://conetic-casino.onrender.com`

---

## 0. First thing to check — is the latest code actually live?

Before anything else, confirm which commit is running in production:

```bash
curl https://conetic-casino.onrender.com/api/version
# → {"buildId":"<8-char SHA>"}
```

Compare against your local `main`:

```bash
git log origin/main --oneline -1
```

If the SHAs don't match, Render didn't pick up your push. The webhook is unreliable — don't wait on it, trigger a deploy manually via **§6 Normal update flow**. Only drop into **§7 Auto-deploy broke** if the manual trigger also fails.

---

## 1. Prerequisites

- GitHub repo: `casino598278/conetic-casino`
- [Render](https://render.com) account with GitHub connected via the [Render GitHub App](https://github.com/apps/render/installations/new)
- Telegram bot from [@BotFather](https://t.me/BotFather) → `BOT_TOKEN` + `BOT_USERNAME`
- TON hot wallet mnemonic: `pnpm exec tsx infra/scripts/gen-hot-wallet.ts`
- Optional: [toncenter.com](https://toncenter.com) API key (free tier is rate-limited)

---

## 2. Create the Render service (one-time)

Render reads `render.yaml` at the repo root and creates everything automatically.

1. Dashboard → **New → Blueprint**
2. Pick the `conetic-casino` repo, branch `main`
3. Render parses `render.yaml` and proposes one web service + 1 GB persistent disk at `services/api/data/`
4. **Apply**

The first deploy will fail at the health check because secrets aren't set yet — that's expected.

### What `render.yaml` covers

- Build: `corepack enable && pnpm install --frozen-lockfile=false && pnpm build`
- Start: `pnpm start` → `node services/api/dist/index.js`
- Health check: `/health`
- Auto-deploy: on (but see §7 — the dashboard can override this)
- Persistent disk so SQLite survives redeploys
- Public env vars (ports, rake bps, bet limits, TON network) baked in

---

## 3. Set secret env vars (Render dashboard)

Service → **Environment** tab:

| Key | Value | Notes |
|-----|-------|-------|
| `BOT_TOKEN` | from BotFather | e.g. `7123456:AA...` |
| `BOT_USERNAME` | from BotFather | no `@` |
| `HOT_WALLET_MNEMONIC` | 24 words from `gen-hot-wallet.ts` | space-separated |
| `TON_API_KEY` | toncenter key | optional |
| `PUBLIC_WEB_URL` | `https://conetic-casino.onrender.com` | the service's own URL |
| `CORS_ORIGIN` | same as `PUBLIC_WEB_URL` | |
| `JWT_SECRET` | auto-generated | leave alone |

Chicken-and-egg: you don't know `PUBLIC_WEB_URL` until the service exists. Create the service first, then fill these in, then **Manual Deploy → Deploy latest commit**.

**Important:** the dashboard Environment tab is the source of truth. Values here override anything in `render.yaml`. If you ever see `/health` reporting a different `ton` network than `render.yaml` says, that's why.

---

## 4. Fund the hot wallet

Find the address in the boot logs (`[wallet] hot wallet address: …`) or via `/api/wallet/hot-address` if that route exists.

- **Testnet:** `@testgiver_ton_bot` or [testnet.tonhub.com](https://testnet.tonhub.com). 1 TON is plenty.
- **Mainnet:** send real TON. Start with ~5 TON for gas headroom and house float.

---

## 5. Wire up the Telegram bot

Once `/health` returns 200:

### 5a. Tell BotFather about the Mini App

```
/setmenubutton
→ pick your bot
→ URL: https://conetic-casino.onrender.com
→ button text: Play
```

The bot ALSO calls `setChatMenuButton` on startup, so this is redundant belt-and-suspenders — either path works.

### 5b. Verify the bot is polling

In Render logs:

```
[bot] @your_bot_username polling
```

If you see `[bot] BOT_TOKEN missing — skipping`, the env var didn't propagate → redeploy.

### 5c. Test commands

Send your bot `/start` in Telegram. Commands registered:

- `/play` — open arena
- `/mine` — open mining
- `/balance` — TON balance
- `/deposit` — deposit address + memo
- `/withdraw` — points to Wallet tab
- `/topup` — demo-only, +25 TON, 30m cooldown
- `/demo` — admin-only, toggle demo for users

The command list is cached by Telegram clients. If new commands (e.g. `/topup`) don't appear in the `/` menu after a redeploy, force-close the chat and reopen, or send `/start`.

---

## 6. Normal update flow

The GitHub → Render webhook is unreliable (see §7), so the working model is: **push, then trigger a deploy manually via the Render API.** Don't wait on auto-deploy.

### 6a. Render API key

Dashboard → avatar (top-right) → **Account Settings** → **API Keys** → **Create API Key**. Name it e.g. `casino`. The key is shown **once** (`rnd_…`) — copy it immediately.

Store it wherever you keep project secrets. For local use, put it in the repo-root `.env` (already in `.gitignore`):

```bash
RENDER_API_KEY=rnd_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
RENDER_SERVICE_ID=srv-d7ft0nu8bjmc73budqeg
```

And source it before running deploy commands:

```bash
set -a; source .env; set +a
```

### 6b. Deploy + verify

```bash
git push origin main

# Trigger the deploy. Returns JSON with an id like dep-xxxx and status "build_in_progress".
curl -sS -X POST \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys" \
  -d '{}'

# Poll /api/version until buildId matches HEAD. Build is ~2 min on starter.
EXPECTED=$(git rev-parse --short=8 HEAD)
until curl -sS https://conetic-casino.onrender.com/api/version | grep -q "\"buildId\":\"$EXPECTED\""; do
  sleep 15
  echo "still $(curl -sS https://conetic-casino.onrender.com/api/version)"
done
echo "LIVE on $EXPECTED"
```

Every PR must end with `/api/version` returning the freshly pushed short SHA before the PR is "done." If the SHA doesn't move after ~5 minutes, inspect the deploy:

```bash
curl -sS -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys?limit=1"
```

A `status` of `live` means it worked; `build_failed` / `update_failed` — go pull logs. `canceled` usually means a newer deploy superseded this one.

### 6c. Useful Render API calls

| Purpose | Call |
|---|---|
| Trigger deploy of HEAD | `POST /v1/services/$RENDER_SERVICE_ID/deploys` |
| Trigger deploy pinned to a commit | `POST .../deploys` with body `{"commitId":"<full-40-sha>"}` |
| Force clean rebuild (clear cache) | `POST .../deploys` with body `{"clearCache":"clear"}` |
| List recent deploys | `GET /v1/services/$RENDER_SERVICE_ID/deploys?limit=10` |
| Fetch one deploy's detail | `GET /v1/services/$RENDER_SERVICE_ID/deploys/<dep-id>` |
| Tail logs for a deploy | `GET /v1/logs?ownerId=<owner>&resource=<dep-id>&limit=200` |
| Read one env var | `GET /v1/services/$RENDER_SERVICE_ID/env-vars` |
| Suspend/resume service | `POST /v1/services/$RENDER_SERVICE_ID/suspend` / `.../resume` |

All calls need `Authorization: Bearer $RENDER_API_KEY`.

Expect ~30 s of downtime on the starter plan during redeploy. SQLite is on a persistent disk, so balances / rounds / ledger survive.

---

## 7. Auto-deploy broke — recovery playbook

Symptom: you push to `main`, no deploy event appears in Render, `/api/version` stays stuck on an old SHA, no failed build either — complete silence.

This is almost always one of four things. Check in this order:

### 7a. Is the webhook actually firing?

Dashboard → your service → **Events** tab.

- **Deploy attempts for recent commits, all failed** → click the failed one → read the build log. Paste the error, fix, push again.
- **No events at all for recent commits** → the webhook isn't firing. Continue to 7b.

### 7b. Is Auto-Deploy toggled on in the dashboard?

Dashboard → **Settings** → **Build & Deploy** → **Auto-Deploy**.

- Should be **On Commit**.
- If it's **After CI Checks Pass** and this repo has no CI checks, Render waits forever — switch to **On Commit**.
- If it's **Off**, turn it on.

**Gotcha:** the `autoDeploy: true` in `render.yaml` is only honored on the *initial* Blueprint sync. After that, the dashboard toggle wins. Changing `render.yaml` won't fix it — you have to flip the toggle in the UI.

### 7c. Did the Render GitHub App lose access to the repo?

Most common silent-break cause. The Render GitHub App's permissions can drift off this repo (repo made private, transferred, or access simply dropped).

Go to [github.com/apps/render/installations/new](https://github.com/apps/render/installations/new) → make sure `casino598278/conetic-casino` is in "Repository access." If it isn't, grant it. Webhooks resume immediately.

Then in Render: **Settings → Build & Deploy → Repository** — if it shows the wrong repo or "Disconnected," click *Update* and reconnect.

### 7d. Branch mismatch

Dashboard → **Settings** → **Build & Deploy** → **Branch**. Must be `main`. If someone switched it, pushes to `main` won't trigger anything.

### 7e. Unblock right now with a Deploy Hook

If you need the service updated before you've diagnosed the above:

1. Dashboard → **Settings** → **Deploy Hook** → copy the secret URL
2. `curl -X POST "https://api.render.com/deploy/srv-XXXX?key=YYYY"`
3. Add `&ref=<commit-sha>` to pin a specific commit

If the deploy hook succeeds but `git push` doesn't trigger one, you've proven the problem is ingress (GitHub App / webhook), not the build itself. Fix 7c.

### 7f. Manual deploy from the UI

Top-right of the service page → **Manual Deploy → Deploy latest commit** (or *Clear build cache & deploy* if you suspect a stale cache). Instant force-push without needing the hook URL.

### 7g. Verify it worked

```bash
curl https://conetic-casino.onrender.com/api/version
```

`buildId` should now match `git rev-parse --short=8 origin/main`.

---

## 8. Other troubleshooting

**Mini App shows "No Telegram initData"**
→ You opened the Render URL directly in a browser. Open via the bot's menu button.

**Health check fails after deploy**
→ Logs will show the missing env var. Usually `HOT_WALLET_MNEMONIC` or `BOT_TOKEN`.

**Deposits don't credit**
→ User must include the memo (`/deposit` shows it). Watcher polls every ~10s; grep logs for `[deposit]`.

**Withdrawals stuck**
→ Hot wallet out of gas, or toncenter rate-limited. Fund the wallet; paid `TON_API_KEY` helps.

**DB wiped after redeploy**
→ Persistent disk not attached. Dashboard → **Disks** should show `casino-data` at `/opt/render/project/src/services/api/data`.

**Free-tier 15-min spin-down**
→ First request after idle takes ~30s to wake. Does NOT affect auto-deploy — webhooks still land while the service is asleep.

---

## 9. Going to mainnet

1. Generate a **fresh** mainnet wallet — never reuse the testnet mnemonic
2. In Render Environment:
   - `TON_NETWORK=mainnet`
   - `TON_ENDPOINT=https://toncenter.com/api/v2/jsonRPC`
   - `HOT_WALLET_MNEMONIC=<new mainnet mnemonic>`
3. Fund the new wallet (start small — ~5 TON)
4. Redeploy
5. Confirm: `curl .../health` returns `"ton":"mainnet"`
6. Round-trip a tiny deposit + withdraw end-to-end before announcing
