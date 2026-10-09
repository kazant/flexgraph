# Plan: A Flexible Relationship Graph (HTML, CSS & JS only)

A graph layout library that gives full control over layout and produces clean, logical edge routing.

The library is written in plain JavaScript (with optional CSS) and published as an open-source (MIT) npm package (see section 11).

## 1. Problems this design solves

A basic implementation of the classic layered (Sugiyama) layout has structural problems, not configuration issues:

| Problem | Cause |
|---|---|
| Unnecessary edge crossings | Crossing minimization runs only a few heuristic sweeps and stops early. |
| Lines overlap each other | Every edge is routed independently through "dummy" points; edges are unaware of one another. |
| Edges bunch up at nodes | No ports — all edges attach to the center of a node side. |
| Lines pass over nodes | No obstacle avoidance in edge routing. |
| Layout jumps around | No constraints (pinning, fixed order) and no incremental layout; small changes reshuffle everything. |
| Limited grouping | Compound/cluster support is basic. |


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
/LICENSE                  – MIT license
/README.md
/src/index.js             – public API: createGraph(), layoutGraph()
/src/model.js             – graph data structure, validation
/src/layout/ranking.js    – cycle removal + rank assignment
/src/layout/ordering.js   – crossing minimization
/src/layout/coords.js     – coordinate assignment
/src/routing/ports.js     – port distribution on node sides
/src/routing/router.js    – orthogonal A* routing
/src/routing/tracks.js    – parallel segment separation
/src/render.js            – DOM + SVG rendering
/src/interaction.js       – drag, zoom, pan, hover, selection
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
4. **Crossing minimization** (the main improvement over a basic layered layout):
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
| 2 | Layered layout with improved crossing minimization | Clean automatic layout |
| 3 | Ports + orthogonal A* routing with obstacle avoidance | Clean, readable lines |
| 4 | Track assignment, line hops, constraints, pinning | No overlapping lines, full control |
| 5 | Groups, incremental layout, animation, performance tuning | Polished, scalable tool |
| 6 | npm packaging, docs site with live examples | Public open-source release |


## 9. Performance notes

- Keep layout code DOM-free; measure node sizes once, then compute.
- Route only changed edges during dragging (`requestAnimationFrame` throttling).
- Use a spatial index (simple grid buckets) for obstacle and crossing checks.
- For large graphs (1000+ nodes), move layout into a Web Worker to keep the UI responsive.
- Render edges as one SVG with reused `<marker>` definitions.

## 10. Testing

- Unit tests for each layout step (pure functions → easy to test).
- A count of edge crossings and edge-over-node overlaps as quality metrics on the sample graphs.
- A set of sample graphs: small tree, dense graph, graph with cycles, grouped graph, large graph.

## 11. npm package

### Package setup

```json
{
  "name": "@kazant/flexgraph",
  "version": "1.0.0",
  "license": "MIT",
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
  "files": ["dist", "css", "types", "LICENSE", "README.md", "CHANGELOG.md"],
  "sideEffects": ["*.css"]
}
```

- Write the source in plain ES modules. Use a bundler (e.g. Rollup or esbuild) only at publish time to produce ESM (for modern bundlers) and UMD (for a plain `<script>` tag) builds.
- Minify the published bundles. Don't publish `src/`.
- Use zero runtime dependencies.
- Ship TypeScript type definitions (`.d.ts`).
- Follow semantic versioning and publish a changelog.

Published to the public npm registry as `@kazant/flexgraph` under the MIT license (see `LICENSE`). An earlier commercial design (license keys, license server, private registry) is kept in the `commercial-archive` branch.
