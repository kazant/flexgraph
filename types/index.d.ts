// Type definitions for @kazant/flexgraph

export type Direction = 'TB' | 'LR' | 'BT' | 'RL';
export type EdgeRouting = 'orthogonal' | 'straight' | 'curved';
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type MarkerName =
  | 'arrow' | 'open' | 'many' | 'one' | 'onlyOne' | 'oneOrMany' | 'zeroOrMany' | 'zeroOrOne'
  | 'diamond' | 'hollowDiamond' | 'circle';

export interface Point { x: number; y: number; }
export interface Rect { x: number; y: number; width: number; height: number; }

export interface PortSpec {
  id: string;
  side: Side;
  /** Position along the side, 0..1. Default: spread evenly in declaration order. */
  offset?: number;
  label?: string;
}

export interface NodeConstraints {
  pinned?: boolean;
  /** Pinned top-left position (world coordinates). */
  x?: number | null;
  y?: number | null;
  /** Fixed rank (layer index). */
  rank?: number | null;
}

export interface NodeSpec {
  id: string;
  label?: string;
  /** Size in px. If omitted, measured from the rendered DOM. */
  width?: number;
  height?: number;
  group?: string;
  ports?: PortSpec[];
  constraints?: NodeConstraints;
  className?: string;
  type?: string;
  /** Trusted HTML content for the default node template. */
  html?: string;
  /** Trusted HTML shown when the node is expanded. A node with details gets a "Details" toggle. */
  details?: string;
  /** Force the details toggle on or off (default: on when `details` or options.renderDetails is set). */
  expandable?: boolean;
  /** Start with the details open. */
  expanded?: boolean;
  /** Show a +/− toggle that stacks the nodes before ("upstream") or after ("downstream", also `true`) this node under it. */
  stackable?: boolean | 'upstream' | 'downstream';
  /** Start with the stack folded (direction from `stackable`). */
  stacked?: boolean;
  [key: string]: unknown;
}

export interface EdgeSpec {
  id?: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  /** Drives CSS class `fg-edge--<type>` and default markers (see options.edgeTypes). */
  type?: string;
  label?: string;
  minLen?: number;
  weight?: number;
  markerStart?: MarkerName | null;
  markerEnd?: MarkerName | null;
  className?: string;
  [key: string]: unknown;
}

export interface GroupSpec { id: string; label?: string; className?: string; }

export type ConstraintSpec =
  | { type: 'leftOf'; a: string; b: string }
  | { type: 'sameRank'; nodes: string[] }
  | { type: 'rank'; node: string; rank: number };

export interface GraphData {
  options?: Partial<GraphOptions>;
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  groups?: GroupSpec[];
  constraints?: ConstraintSpec[];
}

export interface GraphOptions {
  direction: Direction;
  nodeSpacing: number;
  rankSpacing: number;
  edgeSpacing: number;
  edgeRouting: EdgeRouting;
  cornerRadius: number;
  lineHops: boolean;
  hopRadius: number;
  animate: boolean;
  animationDuration: number;
  nodeMargin: number;
  groupPadding: number;
  groupLabelHeight: number;
  componentSpacing: number;
  maxIterations: number;
  bendPenalty: number;
  crossingPenalty: number;
  /** When this many edges leave one side of a node, they share one trunk (tree style). 0 turns it off. Default 5. */
  bundleFanOut: number;
  defaultNodeWidth: number;
  defaultNodeHeight: number;
  pinOnDrag: boolean;
  draggable: boolean;
  zoomable: boolean;
  pannable: boolean;
  minZoom: number;
  maxZoom: number;
  controls: boolean;
  showPorts: boolean;
  /** Hover highlighting: 'chain' (default) lights up the whole path from start to end, 'neighbors' only direct connections. */
  hoverHighlight: 'chain' | 'neighbors';
  /** Keep the hover highlight on the selected (clicked) node or edge until the selection is cleared. Default true. */
  highlightSelection: boolean;
  /**
   * Multi-select (default true): Ctrl/Cmd/Shift + click adds or removes items, Shift + drag on the background draws a
   * selection box, Ctrl/Cmd+A selects all, and dragging a selected node moves the whole selection.
   */
  multiSelect: boolean;
  /**
   * Undo / redo (default true) for moves, pins, relayout, updateGraph, expand / collapse, importState and direction /
   * routing changes. Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y, and buttons in the controls.
   */
  history: boolean;
  /** Undo steps kept. Default 100. */
  historyLimit: number;
  /** Text of the details toggle on expandable nodes. Defaults 'Details' / 'Hide'. */
  expandText: string;
  collapseText: string;
  /**
   * Explore mode for huge hierarchies: only nodes without a parent are shown at first; clicking a node opens its
   * children. Only the open part of the graph is laid out and rendered.
   */
  explore: boolean;
  /** Explore mode: nodes off the open path are 'dim' (default), 'blur' or 'hide'. */
  exploreUnfocused: 'dim' | 'blur' | 'hide';
  /** Explore mode: children shown per node before a "+N more" node (click it to show more). Default 25. */
  exploreLimit: number;
  /** Explore mode: show the path as a breadcrumb in the top-left corner. Default true. */
  exploreBreadcrumb: boolean;
  /** Explore mode: first breadcrumb item (back to the start nodes). Default 'Start'. */
  exploreStartText: string;
  /** Explore mode: label of the "+N more" node. */
  exploreMoreText?: (count: number) => string;
  edgeTypes: Record<string, { markerStart?: MarkerName | null; markerEnd?: MarkerName | null }>;
  /** URL of dist/flexgraph.worker.js to run layout + routing in a Web Worker. */
  worker?: string | URL;
  /** Custom node content. Return an HTML string, an element, or nothing (to fill `el` yourself). */
  renderNode?: (node: NodeSpec, el: HTMLElement) => string | Node | void | null;
  /** Content of an expanded node. When set, every node gets a "Details" toggle (opt out per node with expandable: false). */
  renderDetails?: (node: NodeSpec, el: HTMLElement) => string | Node | void | null;
  onNodeExpand?: (node: NodeSpec, expanded: boolean) => void;
  /** `connections.previous` / `connections.next`: the nodes directly before and after the clicked node. */
  onNodeClick?: (node: NodeSpec, event: PointerEvent, connections: Connections) => void;
  onEdgeClick?: (edge: EdgeSpec, event: PointerEvent) => void;
  onBackgroundClick?: (event: PointerEvent) => void;
  /** Right-click on a node. The browser menu is suppressed when this is set; open your own menu at event.clientX / clientY. */
  onNodeContextMenu?: (node: NodeSpec, event: MouseEvent, connections: Connections) => void;
  onEdgeContextMenu?: (edge: EdgeSpec, event: MouseEvent) => void;
  onGroupContextMenu?: (group: GroupSpec, event: MouseEvent) => void;
  onBackgroundContextMenu?: (event: MouseEvent) => void;
}

export interface ViewState {
  version: 1;
  direction: Direction;
  /** Routing mode the edges were saved with; saved edges are only reused in the same mode. */
  edgeRouting?: EdgeRouting;
  nodes: Record<string, { x: number; y: number; pinned: boolean }>;
  /** Exact edge lines as [x, y] points. Reused on import while the nodes still match, so lines come back as the user left them. */
  edges?: Record<string, [number, number][]>;
  stacked?: [string, 'upstream' | 'downstream'][];
  transform: { x: number; y: number; k: number };
}

export interface Selection { kind: 'node' | 'edge'; id: string; }

export interface GraphEvents {
  layout: { crossings: number };
  select: Selection | null;
  hover: Selection | null;
  nodeclick: { node: NodeSpec; event: PointerEvent; previous: NodeSpec[]; next: NodeSpec[] };
  edgeclick: { edge: EdgeSpec; event: PointerEvent };
  groupclick: { group: GroupSpec; event: PointerEvent };
  /** `ids`: every node being moved (the whole selection when a selected node is dragged). */
  dragstart: { id: string; ids: string[] };
  drag: { id: string; x: number; y: number; ids: string[] };
  dragend: { id: string; x: number; y: number; ids: string[] };
  /**
   * Undo history changed. `data` is the graph data now shown: after an undo it can be an earlier object than the
   * one you last passed to updateGraph, so keep your own copy in sync from here.
   */
  history: { action: 'record' | 'undo' | 'redo' | 'clear'; label?: string; canUndo: boolean; canRedo: boolean; data: GraphData };
  /** The set of selected items changed (`select` only reports the primary item). */
  selectionchange: { items: Selection[]; nodes: NodeSpec[]; edges: EdgeSpec[] };
  pin: { id: string; pinned: boolean };
  change: ViewState;
  viewport: { x: number; y: number; k: number };
  animationend: void;
  expand: { id: string; expanded: boolean; node: NodeSpec };
  stack: { id: string; direction: 'upstream' | 'downstream'; stacked: string[] };
  unstack: { id: string };
  /** Explore mode: the open path changed. */
  explore: { path: string[] };
  /** Right-click anywhere in the graph. Registering a listener suppresses the browser menu inside the graph. */
  contextmenu:
    | { kind: 'node'; id: string; node: NodeSpec; previous: NodeSpec[]; next: NodeSpec[]; event: MouseEvent; selection: Selection[] }
    | { kind: 'edge'; id: string; edge: EdgeSpec; event: MouseEvent; selection: Selection[] }
    | { kind: 'group'; id: string; group: GroupSpec; event: MouseEvent; selection: Selection[] }
    | { kind: 'background'; event: MouseEvent; selection: Selection[] };
}

export interface Connections {
  /** Nodes with an edge into this node (with { chain: true }: everything upstream). */
  previous: NodeSpec[];
  /** Nodes this node has an edge to (with { chain: true }: everything downstream). */
  next: NodeSpec[];
  incoming: EdgeSpec[];
  outgoing: EdgeSpec[];
}

export interface FitOptions {
  /** Space around the fitted area in px. Default 40. */
  padding?: number;
  /** Highest zoom to use. Default: the graph's maxZoom option (4). */
  maxZoom?: number;
  /** Animate the zoom. Default: the graph's animate option. */
  animate?: boolean;
}

export interface GraphView {
  readonly ready: Promise<GraphView>;
  readonly options: GraphOptions;
  relayout(opts?: { animate?: boolean; fresh?: boolean }): Promise<GraphView>;
  updateGraph(data: GraphData, opts?: { mode?: 'stable' | 'relayout'; animate?: boolean; from?: string | Map<string, string>; to?: string | Map<string, string> }): Promise<GraphView>;
  setOptions(options: Partial<GraphOptions>, opts?: { relayout?: boolean }): Promise<GraphView>;
  exportState(): ViewState;
  importState(state: ViewState, opts?: { animate?: boolean; transform?: boolean }): Promise<GraphView>;
  pin(id: string, pinned?: boolean): void;
  unpin(id: string): void;
  unpinAll(): void;
  /**
   * Select one item, several, or nothing. Node ids can be passed as strings.
   * `add` adds to the current selection, `toggle` flips each item in or out of it.
   */
  select(sel: string | Selection | (string | Selection)[] | null, opts?: { add?: boolean; toggle?: boolean }): void;
  /** The primary selected item (the one selected last), or null. */
  getSelection(): Selection | null;
  /** Every selected item, in the order they were selected. */
  getSelectedItems(): Selection[];
  getSelectedNodes(): NodeSpec[];
  getSelectedEdges(): EdgeSpec[];
  selectAll(): void;
  clearSelection(): void;
  /** Undo the last change. Resolves false if there was nothing to undo. */
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Labels of the undo / redo steps, oldest first ("move", "pin", "update", "relayout", "expand", …). */
  getHistory(): { undo: string[]; redo: string[] };
  clearHistory(): void;
  /** Run several changes as one undo step. Returns what fn returns. */
  batch<T>(label: string, fn: () => T): T;
  /** Previous / next nodes of a node (direct, or the whole chain with { chain: true }). null if the id is unknown. */
  getConnections(id: string, opts?: { chain?: boolean }): Connections | null;
  fit(opts?: { padding?: number; maxZoom?: number }): void;
  /**
   * Zoom and pan so the whole flow through a node or edge (everything upstream and downstream) fills the view,
   * as large as possible. Defaults to the selected node or edge (with several selected: fits the selection).
   * Returns false if there is nothing to fit.
   */
  fitFlow(target?: string | Selection | EdgeSpec, opts?: FitOptions & { mode?: 'chain' | 'neighbors' }): boolean;
  /** Zoom and pan so the given nodes and the edges between them fill the view, as large as possible. */
  fitNodes(ids: Iterable<string>, opts?: FitOptions): boolean;
  /** Open (or close) a node's details. The layout makes room; the node keeps its place on screen. */
  expand(id: string, expanded?: boolean): Promise<boolean>;
  collapse(id: string): Promise<boolean>;
  toggleExpand(id: string): Promise<boolean>;
  isExpanded(id: string): boolean;
  /** Fold nodes under `id` with an animation: they slide in underneath it; the node shows a card stack and "+N". */
  stack(id: string, opts?: { direction?: 'upstream' | 'downstream'; animate?: boolean }): Promise<boolean>;
  /** Unfold a stack: the nodes come back out from underneath `id`. */
  unstack(id: string, opts?: { animate?: boolean }): Promise<boolean>;
  toggleStack(id: string, opts?: { direction?: 'upstream' | 'downstream'; animate?: boolean }): Promise<boolean>;
  unstackAll(opts?: { animate?: boolean }): Promise<GraphView>;
  isStacked(id: string): boolean;
  /** Ids folded under `id`, or every folded-away node when `id` is omitted. */
  getStacked(id?: string): string[];
  /** Add nodes/edges; the new nodes come out from underneath `from` (default: their first existing predecessor). */
  addNodes(add: { nodes?: NodeSpec[]; edges?: EdgeSpec[]; groups?: GroupSpec[] }, opts?: { from?: string; animate?: boolean; mode?: 'stable' | 'relayout' }): Promise<GraphView>;
  /** Remove nodes and their edges; they slide into `to` (default: their first remaining neighbour) and disappear. */
  removeNodes(ids: string | string[], opts?: { to?: string; animate?: boolean; mode?: 'stable' | 'relayout' }): Promise<GraphView>;
  /** Explore mode: the open nodes, from a start node down. */
  getExplorePath(): string[];
  /** Explore mode: open a path (each id a child of the one before). [] shows only the start nodes. */
  setExplorePath(path: string[], opts?: { animate?: boolean }): Promise<GraphView>;
  /** Explore mode: close the last open node (also Escape). */
  exploreBack(): Promise<GraphView>;
  zoomBy(factor: number): void;
  zoomTo(k: number): void;
  zoomAt(k: number, clientX: number, clientY: number): void;
  setTransform(t: { x: number; y: number; k: number }): void;
  getTransform(): { x: number; y: number; k: number };
  getLayout(): { nodes: Map<string, Rect>; edges: Map<string, Point[]>; groups: Map<string, Rect> };
  on<K extends keyof GraphEvents>(event: K, cb: (payload: GraphEvents[K]) => void): () => void;
  destroy(): void;
}


export function createGraph(container: HTMLElement | string, data: GraphData, options?: Partial<GraphOptions>): GraphView;

export interface RoutedPath { points: Point[]; kind: EdgeRouting; sourceSide: Side; targetSide: Side; hops: { seg: number; x: number; y: number }[]; /** Set on edges that share a fan-out trunk. */ bundle?: string; }
export interface LayoutResult {
  nodes: Map<string, Rect & { rank: number; order: number }>;
  edges: Map<string, { waypoints: Point[]; reversed: boolean; selfLoop: boolean; flat: boolean }>;
  groups: Map<string, Rect>;
  bounds: Rect;
  crossings: number;
  warnings: string[];
}
export interface RoutingResult { paths: Map<string, RoutedPath>; mode: EdgeRouting; }

/** DOM-free layout + routing (Node, SSR, workers, tests). */
export function layoutGraph(data: GraphData, options?: Partial<GraphOptions>): { model: unknown; layout: LayoutResult; routing: RoutingResult };
export function normalizeGraph(data: GraphData, options?: Partial<GraphOptions>, sizes?: Map<string, { width: number; height: number }>): unknown;
export function computeLayout(model: unknown, extra?: { hints?: Map<string, Point> }): LayoutResult;
export function routeEdges(model: unknown, layout: Pick<LayoutResult, 'nodes' | 'edges'>, state?: unknown): RoutingResult;
export function edgePath(path: RoutedPath, cornerRadius?: number, hops?: RoutedPath['hops'], hopRadius?: number): string;

export const metrics: {
  countCrossings(paths: Map<string, Point[] | { points: Point[] }>): number;
  countNodeOverlaps(paths: Map<string, Point[] | { points: Point[] }>, rects: Map<string, Rect>, edgeById: Map<string, { source: string; target: string }>): number;
  countOverlappingSegments(paths: Map<string, Point[] | { points: Point[] }>): number;
};

export const DEFAULT_OPTIONS: Readonly<GraphOptions>;
export const VERSION: string;
export class GraphValidationError extends Error { details: string[]; }
