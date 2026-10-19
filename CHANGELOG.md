# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Stacking (animated fold / unfold): `stackable: "upstream" | "downstream"` and `stacked` node options, `view.stack(id)`,
  `unstack`, `toggleStack`, `unstackAll`, `isStacked`, `getStacked`, and `stack` / `unstack` events. Folded nodes
  slide in underneath their node, which shows a card stack and a `+N` toggle; unfolding brings them back out from
  underneath. Lines into a stack are redirected (dashed) to the node that holds it. Part of undo / redo and of
  `exportState()` / `importState()`.
- `view.addNodes(..., { from })` and `view.removeNodes(ids, { to })`: new nodes come out from underneath a node,
  removed nodes slide into one. `updateGraph(data, { from, to })` does the same.
- Nodes that appear in any update now come out of the node they belong to (their first existing predecessor), and
  nodes that disappear fade out, instead of popping in and out.

### Fixed
- Focusing a button inside a node no longer scrolls the viewport.
- When a relayout keeps a node in place, the view now pans in step with the node animation.

## [1.2.0] — 2026-10-12

### Added
- Undo / redo (`history`, on by default; `historyLimit` 100): moves (one step per drag, including group drags),
  pins, `relayout`, `updateGraph`, expand / collapse, `importState` and direction / routing changes. Ctrl/Cmd+Z,
  Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y, and ↶ ↷ buttons in the controls. `view.undo()`, `redo`, `canUndo`, `canRedo`,
  `getHistory`, `clearHistory`, `batch(label, fn)` and a `history` event that carries the data now shown.
- Multi-select (`multiSelect`, on by default): Ctrl/Cmd/Shift + click adds or removes nodes and lines, Shift + drag
  on the background draws a selection box, Ctrl/Cmd+A selects all and Esc clears. Dragging a selected node moves
  the whole selection. `view.select([...], { add, toggle })`, `getSelectedItems`, `getSelectedNodes`,
  `getSelectedEdges`, `selectAll`, `clearSelection`, a `selectionchange` event, `selection` in the `contextmenu`
  event and `ids` in the drag events. `fitFlow()` without a target fits a multi-selection.
- Expandable nodes: give a node `details` (HTML) or set `renderDetails(node, el)`, and it gets a "Details" strip at
  the bottom. Opening it makes room in the layout while the node keeps its place on screen. `view.expand(id)`,
  `collapse`, `toggleExpand`, `isExpanded`, `onNodeExpand` and an `expand` event.
- Explore mode for huge hierarchies (`explore: true`): only nodes without a parent are shown at first; clicking a
  node opens its children, clicking it again closes it. Nodes off the open path are dimmed, blurred or hidden
  (`exploreUnfocused`), long child lists end in a "+N more" node (`exploreLimit`), a breadcrumb shows the path and
  badges show child counts. Only the open part of the graph is laid out, so 100 000+ nodes stay fast.
  `view.setExplorePath(path)`, `getExplorePath`, `exploreBack` (also Escape) and an `explore` event.
- Fan-out bundling (`bundleFanOut`, default 5): many edges leaving one side of a node share one trunk, like a
  tree diagram, instead of each taking its own detour.

### Fixed
- Text was blurry after zooming in: the graph is now only a compositor layer while it moves, so the browser redraws
  text sharp at the new zoom.
- Edge labels no longer overlap each other, cover nodes or sit on top of other lines; each label is placed along
  its own line where there is room.
- Lines are easier to click and right-click: the hit area stays 14 screen pixels wide when zoomed out.
- Auto-sized nodes were sometimes 1px too narrow, wrapping their label onto two lines.

## [1.1.0] — 2026-10-09

### Added
- `view.fitFlow(id?)`: zooms and pans so the whole flow through a node or edge (everything upstream and
  downstream) fills the view, as large as possible; defaults to the selection. `view.fitNodes(ids)` does the
  same for any set of nodes. Both include the lines, animate smoothly and stop when the user pans or zooms.
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
