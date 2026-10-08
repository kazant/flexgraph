# FlexGraph: your follow-up checklist

Everything in the code is built and tested (66 tests pass). These are the steps only you can do before you can sell it. Work through them roughly in order.

## 1. Try it locally (15 min)

- [x] Run `npm install` in `D:\_repo\links`
- [ ] Run `npm run dev` and open http://localhost:5173/ (showcase), `/demo/` (playground) and `/docs/` (docs and pricing)
- [ ] Check all samples, directions, routing modes, dragging, add node, save/load
- [x] `git init`, first commit, pushed to a private GitHub repo
- [x] Showcase page deployed to Vercel (`npm run build:site` → `site/`, see `vercel.json`)

## 2. Replace the dummy names with real ones

All placeholders are now filled with **dummy values**. Search the repo for these and swap in the real ones:

| Dummy value | What it is | Where |
|---|---|---|
| `@flexgraph-labs` | npm scope | `package.json`, `README.md`, `docs/index.html`, `types/index.d.ts`, `.npmrc.example`, `showcase/examples.js`, server portal/registry/tests |
| `license.flexgraph.example`, `npm.flexgraph.example`, `portal.flexgraph.example` | domains (`.example` never resolves) | `src/license/verify.js`, `server/wrangler.toml`, `package.json`, docs, legal texts |
| `licenses@`, `privacy@`, `admin@flexgraph.example` | email addresses | `server/wrangler.toml`, `server/src/email.js`, `server/.dev.vars.example`, legal texts |
| FlexGraph Labs AS, org. no. 999 999 999, Eksempelveien 1, 0150 Oslo | company | `LICENSE.md`, `docs/PRIVACY.md`, docs/showcase footers, `scripts/build.mjs` banner |
| `https://flexgraph-labs.lemonsqueezy.com/buy/dummy-0000-checkout` | checkout URL | `server/wrangler.toml` (`CHECKOUT_URL`) |
| `FG-PRJ-DEMO-SHOW-CASE-0001` | showcase license key | `showcase/showcase.js` (replace with a real project key once the license server runs) |

- [ ] Optional: rename the product if "FlexGraph" is not the final name (check that the name and domain are free)

Note: the showcase on Vercel runs in **"unverified"** mode because the dummy license server does not exist; the library never locks on network errors. Once the server is live, register the Vercel domain for the showcase project in the portal and it will show "active".

## 3. Production signing keys

The key pair in the repo now (`server/.dev.vars` + `src/license/public-key.js`) is for development only.

- [ ] Run `npm run keys` to make a new production pair
- [ ] Store the private key in a password manager / secrets manager as a backup
- [ ] Upload it: `cd server && npx wrangler secret put LICENSE_PRIVATE_JWK` (paste the JSON from `server/.dev.vars`)
- [ ] Delete `server/.dev.vars` afterwards (or keep a separate dev key there)
- [ ] Commit the new `src/license/public-key.js` (the public key is safe to commit)
- [ ] Never commit the private key

## 4. Cloudflare (license server, registry, portal)

- [ ] Create a Cloudflare account and add your domain
- [ ] `cd server && npm install`
- [ ] `npx wrangler login`
- [ ] `npx wrangler d1 create flexgraph-license` and put the database id in `wrangler.toml`
- [ ] `npx wrangler r2 bucket create flexgraph-packages`
- [ ] `npm run db:init` (creates the tables)
- [ ] Set the secrets with `npx wrangler secret put …`:
  - [ ] `LICENSE_PRIVATE_JWK` (step 3)
  - [ ] `SESSION_SECRET` (a long random string)
  - [ ] `LEMONSQUEEZY_WEBHOOK_SECRET` or `STRIPE_WEBHOOK_SECRET` (step 5)
  - [ ] `ADMIN_TOKEN` (a long random string, used for publishing)
  - [ ] `RESEND_API_KEY` (step 6)
  - [ ] `ADMIN_EMAIL` (where alerts go)
- [ ] Optional: turn on the Workers rate-limiting binding in `wrangler.toml`
- [ ] `npm run deploy`
- [ ] Check https://license.yourdomain/health returns `{"ok":true}`

## 5. Payment provider

- [ ] Choose a provider. Lemon Squeezy or Paddle handle VAT/MVA for you (merchant of record); Stripe is cheaper but you handle taxes. **Check current fees and tax handling yourself.**
- [ ] Create the product "Project license": $50/month, quantity = number of projects
- [ ] Optional: annual plan $500/year (put its variant ids in `ANNUAL_VARIANT_IDS`)
- [ ] Optional: offline add-on $75/month (pass `custom_data: { offline: true }` at checkout)
- [ ] Add a webhook to `https://license.yourdomain/v1/webhooks/lemonsqueezy` (or `/stripe`) with all subscription events: created, updated, payment success/failed/recovered, cancelled, expired, resumed
- [ ] Put the checkout URL in `CHECKOUT_URL` in `wrangler.toml`
- [ ] Do one test purchase in test mode and check that:
  - [ ] you get a license-key email
  - [ ] the project shows up in the portal
  - [ ] a failed test payment starts the 14-day grace period

## 6. Email

- [ ] Create a Resend account (or swap `server/src/email.js` for another provider)
- [ ] Verify the sending domain (SPF/DKIM)
- [ ] Set `RESEND_API_KEY` and `EMAIL_FROM`

## 7. Monitoring

- [ ] Set up an uptime monitor (e.g. UptimeRobot, Better Stack, Cloudflare health checks) on `https://license.yourdomain/health`
- [ ] Check that daily alert emails (key sharing / unregistered domains) reach `ADMIN_EMAIL`

## 8. Legal (needs a lawyer)

- [ ] Have `LICENSE.md` (EULA) reviewed
- [ ] Have `docs/TERMS.md` reviewed (incl. the EU/EEA 14-day right of withdrawal for consumers)
- [ ] Have `docs/PRIVACY.md` reviewed and add it to your company's privacy policy
- [ ] Check VAT/MVA rules for selling software subscriptions from Norway (largely handled if you use a merchant of record)
- [ ] Make sure the pricing page clearly explains the locked mode ("License inactive" overlay) before people buy

## 9. Publish the package

- [ ] Run `npm test` and `npm run test:server`
- [ ] Set `FLEXGRAPH_ADMIN_URL=https://license.yourdomain` and `FLEXGRAPH_ADMIN_TOKEN=<ADMIN_TOKEN>`
- [ ] `npm run publish:private` (builds, packs and uploads to your private registry)
- [ ] Test as a customer: generate a registry token in the portal, add `.npmrc` (see `.npmrc.example`) to a fresh project and run `npm install @yourscope/flexgraph`
- [ ] Trial: run `npm run build:trial` and publish `dist-trial` publicly as `@yourscope/flexgraph-trial` (watermark, localhost only)

## 10. Docs site and launch

- [x] Host the docs + showcase: done on Vercel. `npm run build:site` builds `dist/` and copies showcase, docs and playground into `site/` with imports switched to `dist/` (library source and server are not published)
- [ ] Add links to the portal, checkout, EULA, terms and privacy policy
- [ ] End-to-end test on a real domain:
  - [ ] no key → "License inactive" overlay
  - [ ] registered domain + active subscription → works
  - [ ] unregistered domain → locked with a clear console message
  - [ ] canceled subscription → locked within at most 7 days

## Later (nice to have)

- [ ] Rotate the signing key periodically (support several public keys / `kid` in the library first)
- [ ] Speed up routing for 1000+ node graphs (the Web Worker option already keeps the UI responsive)
- [ ] Nested groups (only one level of groups is supported now)
- [ ] Network-simplex ranking for even more compact layouts
- [ ] Free licenses for open-source / non-commercial projects (a manual "comp" flag in the database)
- [ ] Admin dashboard (alerts, customers, usage)

## Good to know

- On `localhost` the library always works without a key, so development needs no setup.
- If the license server is down, customer sites keep working (cached token + 14 days; first-time visitors run "unverified").
- The private key must never leave the server. If it leaks, make a new pair, republish the library and ask customers to update.
