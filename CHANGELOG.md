# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-10-09

### Added
- Right-click support for custom context menus: `onNodeContextMenu(node, event, { previous, next })`,
  `onEdgeContextMenu`, `onGroupContextMenu`, `onBackgroundContextMenu` and a `contextmenu` event with
  `{ kind, node | edge | group, event }`. FlexGraph has no built-in menu; the browser menu is only suppressed for
  targets the app handles.

## [1.0.2] — 2026-10-09

### Fixed
- `VERSION` reported 1.0.0 in 1.0.1; it is now synced from package.json by `npm version`, and a test checks it.

## [1.0.1] — 2026-10-09

### Changed
- README and docs: removed the comparison with other libraries; the comparison script and its development dependency are gone.

## [1.0.0] — 2026-10-09

First public release, open source under the MIT license.

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
- Clicking a node or edge keeps its highlight (the hover chain) until the selection is cleared by clicking the
  background, pressing Esc or selecting something else. Turn off with `highlightSelection: false`.
- Node clicks include the neighbouring nodes: `onNodeClick(node, event, { previous, next })` and
  `nodeclick` events get `previous` / `next`. New `view.getConnections(id, { chain })` returns them on demand
  (direct neighbours, or the whole upstream/downstream chain).
- `hoverHighlight` option: `"chain"` (default) highlights the whole upstream and downstream chain of the
  hovered node or edge; `"neighbors"` highlights direct connections only.
- `exportState()` also saves the exact edge lines (`edges`) and the routing mode; `importState()`
  reuses them, so a restored view looks exactly as the user left it. Lines on nodes whose size changed are
  routed fresh.
