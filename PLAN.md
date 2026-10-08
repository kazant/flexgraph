# Plan: A Flexible Relationship Graph (HTML, CSS & JS only)

A replacement for Dagre that gives full control over layout and produces clean, logical edge routing.

The library is written in plain JavaScript (with optional CSS) and distributed as a commercial npm package that requires a license key. The price is **$50 per month per project**, and the library verifies that each project has an active, paid subscription (see sections 11 and 12).

## 1. Why Dagre falls short

Dagre implements the classic layered (Sugiyama) layout. Its problems are structural, not configuration issues:

| Problem | Cause |
|---|---|
| Unnecessary edge crossings | Crossing minimization runs only a few heuristic sweeps and stops early. |
| Lines overlap each other | Every edge is routed independently through "dummy" points; edges are unaware of one another. |
| Edges bunch up at nodes | No ports — all edges attach to the center of a node side. |
| Lines pass over nodes | No obstacle avoidance in edge routing. |
| Layout jumps around | No constraints (pinning, fixed order) and no incremental layout; small changes reshuffle everything. |
| Limited grouping | Compound/cluster support is basic. |

Dagre is also no longer actively developed. (ELK.js is a ready-made pure-JS alternative with ports and orthogonal routing — useful as a reference while building our own.)

## 2. Architecture

Three strictly separated layers:

```
┌──────────────┐    ┌────────────────────┐    ┌──────────────────────┐
│  Data model  │ →  │   Layout engine    │ →  │      Renderer        │
│  (JSON)      │    │ (pure functions,   │    │ HTML divs = nodes    │
│              │    │  no DOM access)    │    │ SVG layer = edges    │
└──────────────┘    └────────────────────┘    └──────────────────────┘
```

- Nodes are HTML `<div>` elements → full CSS styling and rich content.
- Edges are drawn in a single `<svg>` layer behind the nodes.
- A shared container transform handles zoom and pan.
- The layout engine returns positions and edge paths only, so it can be tested and swapped independently.

### Suggested file structure

```
/package.json
/LICENSE.md               – commercial license (EULA)
/README.md
/src/index.js             – public API: createGraph(), setLicenseKey()
/src/model.js             – graph data structure, validation
/src/layout/ranking.js    – cycle removal + rank assignment
/src/layout/ordering.js   – crossing minimization
/src/layout/coords.js     – coordinate assignment
/src/routing/ports.js     – port distribution on node sides
/src/routing/router.js    – orthogonal A* routing
/src/routing/tracks.js    – parallel segment separation
/src/render.js            – DOM + SVG rendering
/src/interaction.js       – drag, zoom, pan, hover, selection
/src/license/verify.js    – license key verification
/src/license/watermark.js – watermark for unlicensed use
/css/graph.css            – default styles (shipped in the package)
/dist/                    – built ESM + UMD bundles (minified)
/demo/index.html          – local demo and test page
```

## 3. Data model

Designed for flexibility from day one:

```js
const graph = {
  options: {
    direction: "LR",          // "TB" | "LR" | "BT" | "RL"
    nodeSpacing: 40,
    rankSpacing: 80,
    edgeRouting: "orthogonal" // "orthogonal" | "straight" | "curved"
  },
  nodes: [
    {
      id: "a",
      label: "Customer",
      width: 160, height: 60,       // or measured from the DOM
      group: "billing",
      ports: [
        { id: "out1", side: "right" },
        { id: "in1",  side: "left" }
      ],
      constraints: { pinned: false, x: null, y: null, rank: null }
    }
  ],
  edges: [
    { id: "e1", source: "a", sourcePort: "out1", target: "b", targetPort: "in1", type: "has-many" }
  ],
  groups: [
    { id: "billing", label: "Billing" }
  ],
  constraints: [
    { type: "leftOf", a: "a", b: "c" },
    { type: "sameRank", nodes: ["b", "c"] }
  ]
};
```

Supported concepts:

- **Ports** – named connection points on a specific side of a node.
- **Groups** – nodes contained in a parent box.
- **Edge types** – drive styling (color, dash, arrowheads) via CSS classes.
- **Constraints** – pinned position, fixed rank, relative order, same rank.

## 4. Node placement — improved layered layout

1. **Cycle removal** – detect back-edges with DFS and temporarily reverse them.
2. **Rank assignment** – longest-path first (simple, fast); add network simplex later for more compact results. Apply `rank` and `sameRank` constraints.
3. **Dummy nodes** – split edges spanning multiple ranks so every edge connects adjacent ranks.
4. **Crossing minimization** (the main improvement over Dagre):
   - Barycenter / median heuristic sweeps (down and up).
   - Repeat until no improvement (with an iteration cap) instead of a fixed small number.
   - Transpose step: swap adjacent nodes in a rank whenever it reduces crossings.
   - Port-aware: calculate positions using port locations, not node centers.
   - Respect `leftOf` constraints and pinned nodes.
   - Keep the best ordering found.
5. **Coordinate assignment** – align nodes to keep long edges straight (Brandes–Köpf style or a simpler priority method), then compact.
6. **Groups** – lay out group contents together and draw group boxes around their bounds.

## 5. Edge routing — the biggest win

### Port distribution

- Edges without explicit ports are assigned to a node side based on direction.
- Edges on the same side are spread evenly and sorted by the position of their other endpoint, which removes crossings right at the node.

### Orthogonal routing with obstacle avoidance

- Build a sparse routing grid from node bounding boxes (plus margin).
- Use A* to find paths with horizontal/vertical segments.
- Cost function penalizes: length, number of bends, crossing other edges, passing near nodes.
- Edges never pass through nodes.

### Track assignment (nudging)

- Find segments sharing the same corridor.
- Assign each to its own parallel track so lines sit side by side instead of on top of each other.
- Order tracks to minimize crossings between them.

### Finishing touches

- Rounded corners on bends.
- Arrowheads / relationship markers (e.g. crow's foot) via SVG `<marker>`.
- Line hops (small arcs) where crossings are unavoidable, so it's clear which line continues where.
- Optional edge labels placed on the longest segment.

## 6. Interaction

- Drag nodes → re-route only affected edges (fast, no full re-layout).
- Pin dragged nodes; the next auto-layout respects them.
- Zoom & pan (wheel + drag background), fit-to-screen button.
- Hover highlighting – highlight a node's edges and neighbors, dim the rest.
- Selection of nodes and edges, with a click callback for custom actions.
- Save / load positions and pins as JSON.
- Animated transitions between layouts (CSS transitions on node positions, interpolated SVG paths).

## 7. Configuration

One options object controls everything, with per-node and per-edge overrides:

```js
const view = createGraph(container, graph, {
  direction: "LR",
  nodeSpacing: 40,
  rankSpacing: 80,
  edgeRouting: "orthogonal",
  cornerRadius: 6,
  lineHops: true,
  animate: true,
  onNodeClick: (node) => {},
  onEdgeClick: (edge) => {}
});

view.relayout();          // full auto layout (respects pins)
view.updateGraph(newData) // incremental update
view.exportState();       // positions + pins as JSON
```

## 8. Build phases

| Phase | Scope | Result |
|---|---|---|
| 1 | Data model, HTML/SVG renderer, zoom & pan, manual dragging, straight edges | Usable manual diagram editor |
| 2 | Layered layout with improved crossing minimization | Automatic layout already better than Dagre |
| 3 | Ports + orthogonal A* routing with obstacle avoidance | Clean, readable lines |
| 4 | Track assignment, line hops, constraints, pinning | No overlapping lines, full control |
| 5 | Groups, incremental layout, animation, performance tuning | Polished, scalable tool |
| 6 | npm packaging, private registry, license server with online validation, payment integration, customer portal, docs site | Sellable product with payment enforcement |

The licensing code (phase 6) can be prototyped early, but it should only be finalized once the API is stable.

## 9. Performance notes

- Keep layout code DOM-free; measure node sizes once, then compute.
- Route only changed edges during dragging (`requestAnimationFrame` throttling).
- Use a spatial index (simple grid buckets) for obstacle and crossing checks.
- For large graphs (1000+ nodes), move layout into a Web Worker to keep the UI responsive.
- Render edges as one SVG with reused `<marker>` definitions.

## 10. Testing

- Unit tests for each layout step (pure functions → easy to test).
- A count of edge crossings and edge-over-node overlaps as quality metrics; compare against Dagre on the same sample graphs.
- A set of sample graphs: small tree, dense graph, graph with cycles, grouped graph, large graph.

## 11. npm package

### Package setup

```json
{
  "name": "@flexgraph-labs/flexgraph",
  "version": "1.0.0",
  "license": "SEE LICENSE IN LICENSE.md",
  "type": "module",
  "main": "./dist/flexgraph.umd.js",
  "module": "./dist/flexgraph.esm.js",
  "exports": {
    ".": {
      "import": "./dist/flexgraph.esm.js",
      "require": "./dist/flexgraph.umd.js"
    },
    "./style.css": "./css/graph.css"
  },
  "files": ["dist", "css", "LICENSE.md", "README.md"],
  "sideEffects": ["*.css"]
}
```

- Write the source in plain ES modules. Use a bundler (e.g. Rollup or esbuild) only at publish time to produce ESM (for modern bundlers) and UMD (for a plain `<script>` tag) builds.
- Minify the published bundles. Don't publish `src/`.
- Use zero runtime dependencies.
- Ship TypeScript type definitions (`.d.ts`).
- Follow semantic versioning and publish a changelog.

### Distribution: private registry (only paying customers can install)

The package is not published to the public npm registry. It is published to a private registry, so only customers with an active subscription can download it.

- Options: GitHub Packages, a private npm organization, a hosted registry (e.g. Cloudsmith, Gemfury), or self-hosted Verdaccio.
- Each customer gets a personal registry access token from the customer portal.
- When a subscription ends, the token is revoked automatically (via webhook). The customer can no longer install or update the package.

Customer setup (`.npmrc` in their project):

```
@flexgraph-labs:registry=https://npm.flexgraph.example/
//npm.flexgraph.example/:_authToken=${FLEXGRAPH_NPM_TOKEN}
```

Also offer a public trial package or an online playground so people can evaluate the library before paying. The trial build always shows a watermark and only runs on localhost.

### Usage for customers

```js
import { createGraph, setLicenseKey } from "@flexgraph-labs/flexgraph";
import "@flexgraph-labs/flexgraph/style.css";

setLicenseKey("FG-PRJ-7K2M-9QXA-...");   // project license key
const view = createGraph(document.getElementById("graph"), data, options);
```

## 12. Licensing & payment enforcement ($50/month per project)

### What counts as a "project"

One license = one project = one application with:

- 1 production domain (e.g. `app.acme.no`), plus its subdomains if the customer chooses a wildcard
- Up to 3 non-production domains (staging, test, preview)
- `localhost` / `127.0.0.1` always allowed for development, at no cost

Customers register their domains in the customer portal. Domains can be changed a limited number of times per month (e.g. 3) to prevent one key from being rotated between many projects. A customer with 3 projects buys 3 licenses ($150/month).

### Reality check

Code running in the browser can always be modified by a determined person, so no system is 100% unbreakable. The goal is to make it impossible to use the library legitimately without paying, and to make bypassing it clearly deliberate (and a breach of the EULA). Enforcement therefore uses several layers together:

| Layer | What it ensures |
|---|---|
| 1. Private registry | Only paying customers can download and update the package |
| 2. Online license validation | The library only runs normally on registered domains with an active, paid subscription |
| 3. Server-side monitoring | Key sharing and use on unregistered domains are detected |
| 4. Legal license (EULA) | Bypassing the check is a contract breach, with an audit clause |

### Layer 2: Online license validation

Flow on page load:

```
Browser (library)                          License server
      │  POST /v1/validate                       │
      │  { key, domain, libVersion }  ─────────► │  1. Key exists?
      │                                          │  2. Subscription active & paid?
      │                                          │  3. Domain registered for this project?
      │  ◄───────── signed license token ──────  │  4. Return signed token
      │  { status, project, domain, expires }    │
      │                                          │
  verify signature with embedded public key
  cache token in localStorage
```

Signed token:

- The server signs the token with a private key (ECDSA P-256) that never leaves the server.
- The library verifies it with the public key embedded in the bundle, using the Web Crypto API (`crypto.subtle.verify`). This means a fake server or a hand-edited response is rejected.
- The token contains: `projectId`, `domain`, `status` (active / past_due / canceled), `paidUntil`, `expires` (issued for 7 days), and `libVersion`.
- The library checks that `domain` matches `location.hostname` exactly, so a token copied to another site doesn't work.

Caching and outages:

- A valid cached token is used without contacting the server (fast page loads, few requests).
- The token is refreshed in the background when it's less than 2 days from expiry.
- If the license server can't be reached, the cached token keeps working until it expires, plus a 14-day grace period. A customer's site never breaks because of a server outage.
- The license server should be on a reliable platform (e.g. Cloudflare Workers + a managed database) with uptime monitoring.

### Behavior by subscription status

| Status | When | Library behavior |
|---|---|---|
| Active | Payment received | Full functionality, no watermark |
| Development | localhost / 127.0.0.1 | Full functionality, no key needed, small "Development" badge |
| Past due | Payment failed | Full functionality for a 14-day grace period; console warning; email to customer from the payment provider |
| Unpaid / canceled | Grace period over or subscription canceled | Locked: the graph renders with a large "License inactive" overlay and interaction is disabled |
| No key / invalid key / unregistered domain | | Same locked mode, with a console message explaining exactly what's wrong and linking to the portal |

The locked mode is deliberately visible to the customer's end users, which is a strong incentive to pay. Customers should be told this clearly on the pricing page and in the EULA, and receive email reminders before the lock happens (e.g. at day 1, 7 and 13 of the grace period).

### Layer 3: Server-side monitoring

The license server logs every validation request (key, domain, timestamp, library version). Store only what is necessary, and no end-user personal data — don't log end-user IP addresses longer than needed for rate limiting (GDPR).

- **Unregistered domains:** requests from a domain not registered on the project are rejected and logged. Repeated attempts trigger an alert.
- **Key sharing:** a key that is validated from many different domains is flagged for review.
- **Usage dashboard:** shows each customer which domains are using their keys.
- **Rate limiting** on the validate endpoint, to prevent abuse.

### Light tamper resistance

- Ship only minified bundles.
- Spread the license check across several places in the code (rendering, layout and routing all check the verified status), rather than one `if` statement that is easy to remove.
- Don't go further than this. Heavy obfuscation hurts performance and debugging for paying customers, and the legal license plus the private registry are the real protection.

### Customer requirements (document clearly)

- The customer's site must be able to reach `https://license.flexgraph.example`. If they use a Content Security Policy, they must add it to `connect-src`.
- **Offline / intranet projects** (no internet access): offer an offline license add-on. It's a signed key bound to the domain, with an expiry date of the paid period + 14 days. A new key is issued automatically each month and must be updated in the project. Price it higher (e.g. $75/month per project) because it's harder to enforce.

### Payments and automation

- The customer subscribes on your website: $50/month, quantity = number of projects.
- The payment provider sends webhooks for: subscription created, payment succeeded, payment failed, subscription canceled.
- The license server updates the database:
  - `customers` (id, email, company)
  - `projects` (id, customer_id, license_key, status, paid_until)
  - `domains` (project_id, hostname, type: production/staging)
  - `registry_tokens` (customer_id, token_hash, revoked)
- On payment success: `status = active`, `paid_until` is extended.
- On payment failure: `status = past_due`, grace period starts.
- On cancellation or grace period end: `status = canceled`, registry token revoked.
- Within at most 7 days (the token lifetime), the library picks up the new status everywhere.

Payment provider options:

| Provider | Notes |
|---|---|
| Lemon Squeezy or Paddle | Merchant of record: they handle VAT/MVA and sales tax worldwide, which simplifies selling from Norway. Support subscriptions with quantities and webhooks. |
| Stripe | More control and lower fees, but you are responsible for taxes (Stripe Tax can help). |

Verify current fees, features, and tax handling with each provider before choosing.

### Customer portal

- Buy, add or remove project licenses
- View and copy license keys and the npm registry token
- Register and manage domains per project
- See validation activity per domain
- View invoices and manage payment methods (link to the payment provider's billing portal)
- Cancel subscription

### Pricing notes

- $50/month per project (the core plan).
- Optional annual plan, e.g. $500/year per project (two months free), for better cash flow and less churn.
- Optional offline license add-on (see above).
- Optional free licenses for open-source or non-commercial projects to grow adoption.

### Legal

- Write a clear `LICENSE.md` / EULA that defines a "project", the domain rules, that the subscription must be active for use in production, that removing or bypassing the license check is prohibited, the right to audit, the grace period and locked-mode behavior, and liability limits.
- Include the license validation in the privacy policy and describe what data the license server receives (key, domain, library version).
- Use a lawyer or a reviewed template. Also check the requirements for selling to businesses and consumers in Norway/EU, including VAT/MVA (much of this is handled by a merchant-of-record provider).

### Phase 6 checklist

- [ ] Bundler setup (ESM + UMD, minified) and package.json
- [ ] Private registry with per-customer tokens and automatic revocation
- [ ] Public trial build (watermark, localhost only)
- [ ] Generate ECDSA key pair; store the private key in a secrets manager (never in the repo)
- [ ] License server: `/v1/validate` endpoint, token signing, rate limiting
- [ ] Database: customers, projects, domains, registry tokens
- [ ] Webhook handling for all subscription events
- [ ] Library: `verify.js` (token check, caching, grace period) and `watermark.js` (overlay + locked mode)
- [ ] Tests: active, past due, canceled, wrong domain, forged token, server offline, expired cache, localhost
- [ ] Monitoring: unregistered domains, key sharing alerts, uptime checks
- [ ] Customer portal
- [ ] Reminder emails during the grace period
- [ ] EULA, terms of service, privacy policy
- [ ] Docs site with live demos, pricing page, CSP and offline instructions
- [ ] Publish to the private registry
