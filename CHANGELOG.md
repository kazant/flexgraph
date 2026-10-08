# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `hoverHighlight` option: `"chain"` (default) highlights the whole upstream and downstream chain of the
  hovered node or edge; `"neighbors"` keeps the previous direct-connections behaviour.
- `exportState()` now also saves the exact edge lines (`edges`) and the routing mode; `importState()`
  reuses them, so a restored view looks exactly as the user left it. Lines on nodes whose size changed are
  routed fresh.

### Fixed
- The `worker` option no longer fails when given a `URL` object (it was sent through `postMessage`).

## [1.0.0] — 2026-10-08

### Added
- Data model with ports, groups, edge types and constraints (pinned, fixed rank, same rank, left-of).
- Layered layout: DFS cycle removal, longest-path ranking with pull-down compaction, dummy nodes,
  crossing minimization (barycenter/median sweeps until no improvement, transpose, sifting, multiple
  starting orders, port-aware), isotonic coordinate assignment that keeps long edges straight.
- Compound layout for groups (group boxes never overlap) with a second pass that orders group
  interiors by their external connections.
- Edge routing: port distribution, orthogonal A* routing with obstacle avoidance, track assignment
  with crossing-aware ordering, line hops, rounded corners, markers, edge labels; straight and curved modes.
- HTML/SVG renderer, zoom/pan/pinch, drag with partial re-routing, pinning, hover highlighting,
  selection, save/load state, animated transitions, incremental updates, Web Worker support.
- Licensing: online validation with ECDSA-signed tokens, 7-day cache, offline grace, past-due grace,
  locked mode, development mode on localhost, offline license keys, trial build.
- License server (Cloudflare Workers): validation, Lemon Squeezy/Stripe webhooks, customer portal,
  private npm registry, daily cron for grace expiry, reminders and key-sharing alerts.
