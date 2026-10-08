# FlexGraph

A flexible relationship graph for the browser — a replacement for Dagre with full control over layout and clean, logical edge routing. Plain HTML, CSS & JavaScript, zero runtime dependencies.

- **Layered layout** with stronger crossing minimization (barycenter + median sweeps until no improvement, transpose, sifting, several starting orders, port-aware).
- **Ports** – named connection points on node sides; auto ports are spread and sorted so edges don't cross at the node.
- **Orthogonal routing** – A* on a sparse grid with obstacle avoidance (edges never pass through nodes), penalties for bends and crossings.
- **Track assignment** – parallel segments are spread onto separate tracks, ordered so they don't cross.
- **Line hops**, rounded corners, arrowheads and ERD markers (crow's foot etc.), edge labels.
- **Groups** (compound layout – boxes never overlap), **constraints** (pinned, fixed rank, same rank, left-of).
- **Interaction** – drag (re-routes only affected edges), pin, zoom/pan/pinch, fit, hover highlighting (whole upstream/downstream chain, or direct neighbors with `hoverHighlight: "neighbors"`), selection, save/load state, animated transitions, incremental updates.
- Layout engine is DOM-free (Node, SSR, Web Worker).

See [PLAN.md](PLAN.md) for the full design.

## Quick start (development)

```bash
npm install
npm run dev        # http://localhost:5173/ (showcase), /demo/ (playground), /docs/
npm run build:site # site/ (what Vercel deploys: showcase + docs + playground on dist/)
npm test           # library tests
npm run test:server
npm run compare    # quality vs Dagre on the sample graphs
npm run build      # dist/ (ESM + UMD + worker, minified)
```

## Usage

```js
import { createGraph, setLicenseKey } from "@flexgraph-labs/flexgraph";
import "@flexgraph-labs/flexgraph/style.css";

setLicenseKey("FG-PRJ-7K2M-9QXA-3HTR-PL0D");   // not needed on localhost

const view = createGraph(document.getElementById("graph"), {
  nodes: [
    { id: "a", label: "Customer", ports: [{ id: "out", side: "right" }] },
    { id: "b", label: "Order", ports: [{ id: "in", side: "left" }] }
  ],
  edges: [{ id: "e1", source: "a", sourcePort: "out", target: "b", targetPort: "in", type: "has-many" }]
}, {
  direction: "LR",
  edgeRouting: "orthogonal",    // "orthogonal" | "straight" | "curved"
  onNodeClick: (node) => console.log(node)
});

view.relayout();               // full auto layout (respects pins)
view.updateGraph(newData);     // incremental: existing nodes stay put
view.exportState();            // positions, pins, zoom and the exact edge lines as JSON
view.importState(saved);       // recreates the saved picture, lines included
```

The container needs a size (e.g. `height: 600px`). Nodes without `width`/`height` are measured from the DOM. Use `renderNode(node, el)` for custom node content (return an HTML string or element).

### Data model

| Concept | Shape |
|---|---|
| Node | `{ id, label?, width?, height?, group?, ports?: [{ id, side, offset? }], constraints?: { pinned, x, y, rank }, className?, type?, html? }` |
| Edge | `{ id?, source, target, sourcePort?, targetPort?, type?, label?, markerStart?, markerEnd?, minLen?, weight? }` |
| Group | `{ id, label? }` |
| Constraints | `{ type: "leftOf", a, b }`, `{ type: "sameRank", nodes: [...] }`, `{ type: "rank", node, rank }` |

Edge `type` sets the CSS class `fg-edge--<type>` and default markers (`has-many`, `has-one`, `belongs-to`, `many-to-many`, `association`, `composition`, `dependency`; extend with `options.edgeTypes`). Markers: `arrow`, `open`, `many`, `one`, `onlyOne`, `oneOrMany`, `zeroOrMany`, `zeroOrOne`, `diamond`, `hollowDiamond`, `circle`.

### Events

`view.on(name, cb)` with `layout`, `select`, `hover`, `nodeclick`, `edgeclick`, `groupclick`, `dragstart`, `drag`, `dragend`, `pin`, `change`, `viewport`, `license`, `animationend`.

### Theming

All colours are CSS custom properties on `.fg-container` (`--fg-node-bg`, `--fg-edge-color`, `--fg-accent`, …). Dark mode follows `prefers-color-scheme`; force with `.fg-theme-dark` / `.fg-theme-light`.

### Large graphs

Run layout + routing in a Web Worker:

```js
createGraph(el, data, { worker: new URL("@flexgraph-labs/flexgraph/worker", import.meta.url) });
```

### Headless

```js
import { layoutGraph } from "@flexgraph-labs/flexgraph";
const { layout, routing } = layoutGraph(data, { direction: "LR" });   // Maps of rects and point lists
```

## Quality vs Dagre

`npm run compare` on the bundled samples (lower is better):

| Graph | Nodes / edges | Crossings FlexGraph / Dagre | Edges over nodes FlexGraph / Dagre |
|---|---|---|---|
| ERD (ports, groups) | 9 / 10 | 0 / 2 | 0 / 2 |
| Tree | 22 / 21 | 0 / 0 | 0 / 0 |
| Dense | 18 / 40 | 47 / 61 | 0 / 5 |
| Cycles | 7 / 11 | 1 / 0 | 0 / 0 |
| Grouped | 12 / 14 | 0 / 1 | 0 / 0 |
| Large | 150 / 208 | 461 / 561 | 0 / 131 |

## Licensing

Commercial: **$50 per month per project** (see [LICENSE.md](LICENSE.md)). On `localhost` the library runs free in Development mode. On other domains it validates the key online (`POST https://license.flexgraph.example/v1/validate`), verifies the server's ECDSA-signed token with the public key in the bundle, caches it for 7 days, and keeps working through server outages (cached token + 14 days; first-time visitors run "unverified"). Unpaid/canceled projects show a "License inactive" overlay.

**Customer requirements**

- Allow `https://license.flexgraph.example` in your Content Security Policy: `connect-src 'self' https://license.flexgraph.example`.
- Register your production domain (+ up to 3 staging domains) in the customer portal.
- Intranet / offline projects: use the offline add-on (`FG-OFF-…` key bound to the domain, renewed monthly by email).

Install from the private registry (`.npmrc`):

```
@flexgraph-labs:registry=https://npm.flexgraph.example/
//npm.flexgraph.example/:_authToken=${FLEXGRAPH_NPM_TOKEN}
```

## Repository layout

```
src/              library source (ES modules)
  layout/         ranking, ordering (crossing minimization), coords, compound groups
  routing/        ports, A* router, track nudging, hops, geometry
  license/        verify (tokens, cache, grace), watermark, gate, public key
css/graph.css     default styles
types/index.d.ts  TypeScript definitions
demo/             playground page + sample graphs
showcase/         showcase page with live examples (deployed to Vercel)
docs/             docs site, pricing, privacy policy, terms
test/             library tests (node --test)
server/           license server: Cloudflare Worker + D1 + R2 (validation, webhooks, portal, registry, cron)
scripts/          build, dev server, key generation, Dagre comparison, private publish
```

## Phase 6 checklist

| Item | Status |
|---|---|
| Bundler setup (ESM + UMD, minified) and package.json | Done — `npm run build` (UMD ships as `.cjs` because the package is `"type": "module"`) |
| Private registry with per-customer tokens and automatic revocation | Done — `server/src/registry.js` (R2-backed, npm compatible) |
| Public trial build (watermark, localhost only) | Done — `npm run build:trial` → `dist-trial/` |
| ECDSA key pair; private key in a secrets manager | Script done (`npm run keys`). **You:** generate the production pair and `wrangler secret put LICENSE_PRIVATE_JWK` |
| License server: `/v1/validate`, token signing, rate limiting | Done |
| Database: customers, projects, domains, registry tokens | Done — `server/schema.sql` |
| Webhook handling for all subscription events | Done — Lemon Squeezy + Stripe |
| Library: verify.js and watermark.js | Done |
| Tests: active, past due, canceled, wrong domain, forged token, server offline, expired cache, localhost | Done — `test/license.test.js`, `server/test/` |
| Monitoring: unregistered domains, key sharing alerts, uptime checks | Alerts done (daily cron). **You:** point an uptime monitor at `/health` |
| Customer portal | Done — `server/public/portal/` |
| Reminder emails during the grace period | Done — day 1, 7, 13 (Resend) |
| EULA, terms of service, privacy policy | Drafts in `LICENSE.md`, `docs/TERMS.md`, `docs/PRIVACY.md`. **You:** have a lawyer review |
| Docs site with live demos, pricing page, CSP and offline instructions | Done — `docs/index.html` |
| Publish to the private registry | Script done (`npm run publish:private`). **You:** deploy the server and publish |

Replace the dummy values (`@flexgraph-labs`, `*.flexgraph.example`, FlexGraph Labs AS) with your real names before going live.
