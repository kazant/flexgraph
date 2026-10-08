# FlexGraph license server

Cloudflare Worker + D1 (SQLite) + R2. Handles license validation, payment webhooks, the customer portal, the private npm registry and daily maintenance.

| Endpoint | Purpose |
|---|---|
| `POST /v1/validate` | `{ key, domain, libVersion }` → `{ token }` signed with ECDSA P-256 (7-day token) |
| `POST /v1/webhooks/lemonsqueezy` | Lemon Squeezy events (X-Signature HMAC) |
| `POST /v1/webhooks/stripe` | Stripe events (Stripe-Signature) |
| `/v1/portal/*` | Customer portal API (magic-link sessions) |
| `GET /portal/` | Customer portal UI |
| `npm.flexgraph.example/*` | Private registry (Bearer token per customer) |
| `PUT /v1/admin/packages` | Publish a version (ADMIN_TOKEN) |
| `GET /health` | Uptime checks |
| Cron (daily) | Grace expiry → canceled + registry revoke, reminders day 1/7/13, key-sharing alerts, offline key renewal, 90-day retention |

## Setup

```bash
cd server
npm install
npx wrangler d1 create flexgraph-license          # put the id into wrangler.toml
npx wrangler r2 bucket create flexgraph-packages
npm run db:init

# keys: run in the repo root, then upload the private key and delete server/.dev.vars
npm --prefix .. run keys
npx wrangler secret put LICENSE_PRIVATE_JWK      # paste the JSON from .dev.vars
npx wrangler secret put SESSION_SECRET           # long random string
npx wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET   # or STRIPE_WEBHOOK_SECRET
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ADMIN_EMAIL
npm run deploy
```

Then:

1. **Payment provider:** create a product "FlexGraph project license" — $79/month (and optionally $790/year) with quantity = number of projects. Point the webhook to `https://license.flexgraph.example/v1/webhooks/lemonsqueezy` with the subscription events (created, updated, payment success/failed/recovered, cancelled, expired, resumed). Put the checkout URL in `CHECKOUT_URL`. For the offline add-on pass `custom_data: { offline: true }` at checkout.
2. **Uptime monitoring:** monitor `https://license.flexgraph.example/health`.
3. **Publish:** `FLEXGRAPH_ADMIN_URL=https://license.flexgraph.example FLEXGRAPH_ADMIN_TOKEN=… npm run publish:private` (repo root).
4. **Trial package:** `npm run build:trial` and publish `dist-trial` publicly as `@flexgraph-labs/flexgraph-trial`.

Important: the public key in `src/license/public-key.js` must match the private key on the server. Rebuild and republish the library after rotating keys.

## Tests

```bash
npm test     # node --test (in-memory D1 via node:sqlite)
```
