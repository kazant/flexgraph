# FlexGraph

[![npm](https://img.shields.io/npm/v/@kazant/flexgraph)](https://www.npmjs.com/package/@kazant/flexgraph) [![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![sponsor](https://img.shields.io/badge/sponsor-%E2%99%A5-db2777)](https://github.com/sponsors/kazant)

A flexible relationship graph for the browser, with full control over layout and clean, logical edge routing. Plain HTML, CSS & JavaScript, zero runtime dependencies. Free and open source (MIT).

**[Live examples](https://flexgraph-showcase.vercel.app) · [Docs](https://flexgraph-showcase.vercel.app/docs/) · [Playground](https://flexgraph-showcase.vercel.app/demo/)**

- **Layered layout** with stronger crossing minimization (barycenter + median sweeps until no improvement, transpose, sifting, several starting orders, port-aware).
- **Ports** – named connection points on node sides; auto ports are spread and sorted so edges don't cross at the node.
- **Orthogonal routing** – A* on a sparse grid with obstacle avoidance (edges never pass through nodes), penalties for bends and crossings.
- **Track assignment** – parallel segments are spread onto separate tracks, ordered so they don't cross.
- **Line hops**, rounded corners, arrowheads and ERD markers (crow's foot etc.), edge labels.
- **Groups** (compound layout – boxes never overlap), **constraints** (pinned, fixed rank, same rank, left-of).
- **Fan-out bundling** – many edges leaving one side of a node share a trunk, like a tree diagram.
- **Edge labels** placed so they don't overlap each other, nodes or other lines.
- **Expandable nodes** – a "Details" strip opens your own content; the layout makes room.
- **Explore mode** for huge hierarchies – start nodes first, click to open children level by level; only what is open is laid out.
- **Multi-select** – Ctrl/Cmd/Shift + click, Shift + drag selection box, Ctrl+A; drag one selected node to move them all.
- **Undo / redo** – Ctrl+Z / Ctrl+Shift+Z for moves, pins, relayout, data updates and expand / collapse.
- **Interaction** – drag (re-routes only affected edges), pin, zoom/pan/pinch (text stays sharp at any zoom), fit, hover highlighting (whole upstream/downstream chain, or direct neighbors with `hoverHighlight: "neighbors"`; a clicked node stays highlighted), selection, save/load state, animated transitions, incremental updates.
- Layout engine is DOM-free (Node, SSR, Web Worker).

## Install

```bash
npm install @kazant/flexgraph
```

Or without a bundler, from a CDN:

```html
<link rel="stylesheet" href="https://unpkg.com/@kazant/flexgraph/css/graph.css">
<script src="https://unpkg.com/@kazant/flexgraph"></script>   <!-- window.FlexGraph.createGraph(...) -->
```

## Usage

```js
import { createGraph } from "@kazant/flexgraph";
import "@kazant/flexgraph/style.css";

const view = createGraph(document.getElementById("graph"), {
  nodes: [
    { id: "a", label: "Customer", ports: [{ id: "out", side: "right" }] },
    { id: "b", label: "Order", ports: [{ id: "in", side: "left" }] }
  ],
  edges: [{ id: "e1", source: "a", sourcePort: "out", target: "b", targetPort: "in", type: "has-many" }]
}, {
  direction: "LR",
  edgeRouting: "orthogonal",    // "orthogonal" | "straight" | "curved"
  onNodeClick: (node, event, { previous, next }) =>
    console.log(node.label, "previous:", previous.map((n) => n.label), "next:", next.map((n) => n.label))
});

view.relayout();               // full auto layout (respects pins)
view.updateGraph(newData);     // incremental: existing nodes stay put
view.fitFlow("b");             // zoom so the whole flow through "b" fills the view; no argument = the selection
view.getConnections("b");      // { previous: [nodeA], next: [], incoming, outgoing }; { chain: true } for the whole chain
view.exportState();            // positions, pins, zoom and the exact edge lines as JSON
view.importState(saved);       // recreates the saved picture, lines included
```

The container needs a size (e.g. `height: 600px`). Nodes without `width`/`height` are measured from the DOM. Use `renderNode(node, el)` for custom node content (return an HTML string or element).

### Data model

| Concept | Shape |
|---|---|
| Node | `{ id, label?, width?, height?, group?, ports?: [{ id, side, offset? }], constraints?: { pinned, x, y, rank }, className?, type?, html?, details?, expandable?, expanded? }` |
| Edge | `{ id?, source, target, sourcePort?, targetPort?, type?, label?, markerStart?, markerEnd?, minLen?, weight? }` |
| Group | `{ id, label? }` |
| Constraints | `{ type: "leftOf", a, b }`, `{ type: "sameRank", nodes: [...] }`, `{ type: "rank", node, rank }` |

Edge `type` sets the CSS class `fg-edge--<type>` and default markers (`has-many`, `has-one`, `belongs-to`, `many-to-many`, `association`, `composition`, `dependency`; extend with `options.edgeTypes`). Markers: `arrow`, `open`, `many`, `one`, `onlyOne`, `oneOrMany`, `zeroOrMany`, `zeroOrOne`, `diamond`, `hollowDiamond`, `circle`.

### Events

`view.on(name, cb)` with `layout`, `history`, `select`, `selectionchange`, `hover`, `nodeclick`, `edgeclick`, `groupclick`, `dragstart`, `drag`, `dragend`, `pin`, `change`, `viewport`, `animationend`, `contextmenu`, `expand`, `explore`.

### Undo / redo

Moves (a whole drag is one step), pins, `relayout()`, `updateGraph()`, expand / collapse, `importState()` and direction or routing changes can be undone with Ctrl/Cmd+Z and redone with Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y, or with the ↶ ↷ buttons in the controls. Selection, zoom and explore navigation are not undo steps.

```js
view.undo(); view.redo();                 // Promise<boolean>
view.canUndo(); view.getHistory();        // { undo: ["move", "update"], redo: [] }
view.batch("tidy", () => { view.unpinAll(); return view.relayout(); });   // one step

// undo can bring back earlier data (a removed node, say): keep your copy in sync
view.on("history", ({ data, canUndo, canRedo }) => { myData = data; });
```

The data is kept by reference, so pass `updateGraph` a new object instead of editing the old one in place. Turn it off with `history: false`; `historyLimit` (default 100) caps the steps kept.

### Selecting several items

Ctrl/Cmd/Shift + click adds a node or line to the selection (or removes it), Shift + drag on the background draws a selection box, Ctrl/Cmd+A selects every node and Esc clears. Dragging a selected node moves the whole selection. Turn it off with `multiSelect: false`.

```js
view.select(["a", "b", { kind: "edge", id: "e1" }]);   // also { add: true } or { toggle: true }
view.getSelectedNodes();                               // the original node objects
view.on("selectionchange", ({ nodes, edges }) => { /* … */ });
view.on("contextmenu", ({ node, selection }) => { /* e.g. "Delete 3 selected" */ });
```

`select` / `getSelection()` keep working as before and report the primary item (the one selected last).

Lines are easy to hit: the click area stays 14 screen pixels wide at any zoom. `onEdgeClick(edge, event)` and `onEdgeContextMenu(edge, event)` work like their node versions.

### Expandable nodes

Give a node `details` (trusted HTML), or set `renderDetails` to give every node a "Details" strip at the bottom. Clicking it opens the node; the layout makes room and the node keeps its place on screen. Details are only built while the node is open.

```js
createGraph(el, data, {
  renderDetails: (node) => `<dl><dt>Owner</dt><dd>${node.data.owner}</dd></dl>`,  // or { details: "…" } per node
  onNodeExpand: (node, expanded) => { /* … */ }
});
view.expand("api"); view.collapse("api"); view.toggleExpand("api"); view.isExpanded("api");
```

Opt a node out with `expandable: false`, or start it open with `expanded: true`. The toggle text is `expandText` / `collapseText`.

### Explore mode (huge hierarchies)

For trees too big to show at once (say 10 start nodes, each with 1 000 children, each with 1 000 more), `explore: true` shows only the nodes without a parent. Clicking a node opens its children; clicking it again closes it. Only the open part of the graph is laid out and rendered.

```js
createGraph(el, { nodes, edges }, {
  explore: true,
  exploreUnfocused: "dim",   // nodes off the open path: "dim" | "blur" | "hide"
  exploreLimit: 25           // children per node before a "+N more" node (click it for more)
});
view.setExplorePath(["region1", "site7"]);   // open a path from code; [] = start nodes only
view.exploreBack();                          // close the last node (also Escape)
view.on("explore", ({ path }) => { /* … */ });
```

A breadcrumb in the top-left corner shows the open path (`exploreBreadcrumb: false` hides it), and each node shows a badge with its number of children.

### Right-click (context menus)

FlexGraph has no built-in menu; it tells you what was right-clicked so you can open your own:

```js
createGraph(el, data, {
  onNodeContextMenu: (node, event, { previous, next }) => openMyMenu(event.clientX, event.clientY, node),
  onEdgeContextMenu: (edge, event) => { /* … */ },
  onGroupContextMenu: (group, event) => { /* … */ },
  onBackgroundContextMenu: (event) => { /* … */ }
});

// or one listener for everything: kind is "node" | "edge" | "group" | "background"
view.on("contextmenu", ({ kind, node, edge, group, event }) => { /* … */ });
```

The browser's own menu is only suppressed for targets you handle. Text fields and links inside nodes keep the normal browser menu.

### Theming

All colours are CSS custom properties on `.fg-container` (`--fg-node-bg`, `--fg-edge-color`, `--fg-accent`, …). Dark mode follows `prefers-color-scheme`; force with `.fg-theme-dark` / `.fg-theme-light`.

### Large graphs

Run layout + routing in a Web Worker:

```js
createGraph(el, data, { worker: new URL("@kazant/flexgraph/worker", import.meta.url) });
```

### Headless

```js
import { layoutGraph } from "@kazant/flexgraph";
const { layout, routing } = layoutGraph(data, { direction: "LR" });   // Maps of rects and point lists
```

## How it's built

Written from scratch in plain JavaScript (ES modules, ES2020); not a fork or wrapper of another library.

| Package | Used for | Shipped? |
|---|---|---|
| none | runtime: the library imports nothing | — |
| `esbuild` | building the bundles (dev dependency) | no |

- **Layout:** Sugiyama-style layered layout: DFS cycle removal, longest-path ranking with compaction, barycenter/median crossing minimization (as in Graphviz *dot*) with transposition and sifting, isotonic-regression coordinate assignment.
- **Routing:** A* on a sparse orthogonal grid with bend/crossing penalties, track nudging, line hops.
- **Browser features:** SVG, CSS custom properties, Pointer Events, `requestAnimationFrame`, optional Web Worker. No network requests, no `eval`.
- **Size:** about 91 kB minified / 33 kB gzipped (ESM), worker 40 kB.
- **Tooling:** Node.js 20+, tests with `node --test`.

## Development

```bash
npm install
npm run dev        # http://localhost:5173/ (showcase), /demo/ (playground), /docs/
npm test           # library tests
npm run build      # dist/ (ESM + UMD + worker, minified)
npm run build:site # site/ (what Vercel deploys: showcase + docs + playground on dist/)
```

```
src/              library source (ES modules)
  layout/         ranking, ordering (crossing minimization), coords, compound groups
  routing/        ports, A* router, track nudging, hops, geometry
css/graph.css     default styles
types/index.d.ts  TypeScript definitions
demo/             playground page + sample graphs
showcase/         page with live examples
docs/             docs page
test/             library tests (node --test)
scripts/          build, dev server, site build
```

See [PLAN.md](PLAN.md) for the design. Bug reports, ideas and pull requests are welcome.

## Support

FlexGraph is free and built by one person. If it saves you or your company time, [a donation through GitHub Sponsors](https://github.com/sponsors/kazant) is much appreciated and helps keep it maintained.

## License

[MIT](LICENSE) © 2026 Alexander Pettersen (kazant)
