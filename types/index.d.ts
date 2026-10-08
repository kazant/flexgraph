// Type definitions for @flexgraph-labs/flexgraph

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
  edgeTypes: Record<string, { markerStart?: MarkerName | null; markerEnd?: MarkerName | null }>;
  /** URL of dist/flexgraph.worker.js to run layout + routing in a Web Worker. */
  worker?: string | URL;
  /** Custom node content. Return an HTML string, an element, or nothing (to fill `el` yourself). */
  renderNode?: (node: NodeSpec, el: HTMLElement) => string | Node | void | null;
  onNodeClick?: (node: NodeSpec, event: PointerEvent) => void;
  onEdgeClick?: (edge: EdgeSpec, event: PointerEvent) => void;
  onBackgroundClick?: (event: PointerEvent) => void;
}

export interface ViewState {
  version: 1;
  direction: Direction;
  nodes: Record<string, { x: number; y: number; pinned: boolean }>;
  transform: { x: number; y: number; k: number };
}

export interface Selection { kind: 'node' | 'edge'; id: string; }

export interface GraphEvents {
  layout: { crossings: number };
  select: Selection | null;
  hover: Selection | null;
  nodeclick: { node: NodeSpec; event: PointerEvent };
  edgeclick: { edge: EdgeSpec; event: PointerEvent };
  groupclick: { group: GroupSpec; event: PointerEvent };
  dragstart: { id: string };
  drag: { id: string; x: number; y: number };
  dragend: { id: string; x: number; y: number };
  pin: { id: string; pinned: boolean };
  change: ViewState;
  viewport: { x: number; y: number; k: number };
  license: LicenseState;
  animationend: void;
}

export interface GraphView {
  readonly ready: Promise<GraphView>;
  readonly options: GraphOptions;
  relayout(opts?: { animate?: boolean; fresh?: boolean }): Promise<GraphView>;
  updateGraph(data: GraphData, opts?: { mode?: 'stable' | 'relayout'; animate?: boolean }): Promise<GraphView>;
  setOptions(options: Partial<GraphOptions>, opts?: { relayout?: boolean }): Promise<GraphView>;
  exportState(): ViewState;
  importState(state: ViewState, opts?: { animate?: boolean; transform?: boolean }): Promise<GraphView>;
  pin(id: string, pinned?: boolean): void;
  unpin(id: string): void;
  unpinAll(): void;
  select(sel: string | Selection | null): void;
  getSelection(): Selection | null;
  fit(opts?: { padding?: number; maxZoom?: number }): void;
  zoomBy(factor: number): void;
  zoomTo(k: number): void;
  zoomAt(k: number, clientX: number, clientY: number): void;
  setTransform(t: { x: number; y: number; k: number }): void;
  getTransform(): { x: number; y: number; k: number };
  getLayout(): { nodes: Map<string, Rect>; edges: Map<string, Point[]>; groups: Map<string, Rect> };
  on<K extends keyof GraphEvents>(event: K, cb: (payload: GraphEvents[K]) => void): () => void;
  destroy(): void;
}

export type LicenseMode = 'pending' | 'active' | 'development' | 'trial' | 'past_due' | 'unverified' | 'locked';
export interface LicenseState {
  mode: LicenseMode;
  reason?: string;
  message?: string;
  portal?: string;
  projectId?: string;
  daysLeft?: number;
  offlineGrace?: boolean;
}

export function createGraph(container: HTMLElement | string, data: GraphData, options?: Partial<GraphOptions>): GraphView;
export function setLicenseKey(key: string | null, opts?: { endpoint?: string }): Promise<LicenseState>;
export function getLicenseState(): LicenseState;
export function onLicenseChange(cb: (state: LicenseState) => void): () => void;

export interface RoutedPath { points: Point[]; kind: EdgeRouting; sourceSide: Side; targetSide: Side; hops: { seg: number; x: number; y: number }[]; }
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
