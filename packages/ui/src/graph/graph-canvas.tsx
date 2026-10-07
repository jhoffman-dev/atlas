import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import {
  neighboursOf,
  nodeRadius,
  type GraphEdge,
  type GraphNode,
  type StatusTone,
  type VaultGraph,
  type VaultPath,
} from '@atlas/domain';
import { useForceLayout, type Point } from './use-force-layout.ts';

/** Pan and zoom: a translation in screen pixels and a scale. */
interface View {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
/** How far the pointer may move and still count as a click, not a drag. */
const CLICK_SLOP = 4;
/** Below this many notes every title is drawn; above it, only when zoomed in or pointed at. */
const ALWAYS_LABELLED = 40;

export interface OpenRequest {
  /** Cmd or Ctrl held: beside the note already open, not over it. */
  readonly split: boolean;
}

/**
 * The graph as a picture: notes as dots sized by how connected they are and
 * coloured by type, links as lines and relations as dashed lines named on
 * hover. Drag the ground to pan, the wheel to zoom, a note to move it; point at
 * a note to light its neighbours, click it to open it.
 *
 * Not keyboard-friendly by nature, so the page offers the same graph as a list.
 */
export function GraphCanvas({
  graph,
  tones,
  centre,
  onOpen,
}: {
  graph: VaultGraph;
  tones: ReadonlyMap<string, StatusTone>;
  /** The note a local graph is drawn around, marked as such. */
  centre: VaultPath | null;
  onOpen: (path: VaultPath, request: OpenRequest) => void;
}) {
  const { positions, drag } = useForceLayout(graph);
  // Null until the person pans or zooms: until then the whole graph is fitted to the stage.
  const [chosen, setView] = useState<View | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const surface = useRef<SVGSVGElement>(null);
  const size = useSize(surface);
  const view = chosen ?? fitView(positions, size);
  const neighbours = useMemo(() => neighboursOf(graph.edges), [graph.edges]);
  const lit = hovered === null ? null : new Set([hovered, ...(neighbours.get(hovered) ?? [])]);
  const labelAll = graph.nodes.length <= ALWAYS_LABELLED || view.k >= 1.4;

  const toGraph = (event: { clientX: number; clientY: number }): Point => {
    const box = surface.current?.getBoundingClientRect();
    const originX = (box?.left ?? 0) + (box?.width ?? 0) / 2;
    const originY = (box?.top ?? 0) + (box?.height ?? 0) / 2;
    return {
      x: (event.clientX - originX - view.x) / view.k,
      y: (event.clientY - originY - view.y) / view.k,
    };
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    const factor = Math.exp(-event.deltaY * 0.0015);
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
    const at = toGraph(event);
    // Zoom about the pointer: the point under it stays under it.
    setView({ k, x: view.x + at.x * (view.k - k), y: view.y + at.y * (view.k - k) });
  };

  const handlers = useGestures({ view, setView, toGraph, drag, onOpen });

  return (
    <svg
      ref={surface}
      className="graph__surface"
      viewBox={`${-size.width / 2} ${-size.height / 2} ${size.width} ${size.height}`}
      role="img"
      aria-label={`${graph.nodes.length} notes and ${graph.edges.length} connections. The list view has them as text.`}
      onWheel={onWheel}
      onPointerDown={handlers.startPan}
      onPointerMove={handlers.move}
      onPointerUp={handlers.end}
      onPointerCancel={handlers.end}
    >
      <g className="graph__world" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        {graph.edges.map((edge) => (
          <Edge
            key={edge.id}
            edge={edge}
            from={positions.get(edge.source)}
            to={positions.get(edge.target)}
            dim={hovered !== null && edge.source !== hovered && edge.target !== hovered}
            labelled={hoveredEdge === edge.id}
            onHover={(on) => setHoveredEdge(on ? edge.id : null)}
          />
        ))}
        {graph.nodes.map((node) => (
          <Node
            key={node.path}
            node={node}
            at={positions.get(node.path)}
            tone={node.type === null ? null : (tones.get(node.type) ?? null)}
            centre={node.path === centre}
            dim={lit !== null && !lit.has(node.path)}
            labelled={labelAll || lit?.has(node.path) === true || node.path === centre}
            onHover={(on) => setHovered(on ? node.path : null)}
            onPointerDown={(event) => handlers.startDrag(event, node.path)}
          />
        ))}
      </g>
    </svg>
  );
}

/** Room left around the graph when it is fitted to the stage, as a share of the stage. */
const FIT_MARGIN = 0.9;
/** A few notes are fitted a little larger than life, not blown up to fill the stage. */
const FIT_MAX_ZOOM = 1.6;

/**
 * The pan and zoom that show every note: centred on the middle of the layout,
 * scaled to fit the stage, but never blown up past {@link FIT_MAX_ZOOM}.
 */
function fitView(
  positions: ReadonlyMap<string, Point>,
  size: { width: number; height: number },
): View {
  if (positions.size === 0) return { x: 0, y: 0, k: 1 };
  const xs = [...positions.values()].map((point) => point.x);
  const ys = [...positions.values()].map((point) => point.y);
  const [left, right, top, bottom] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  // A label hangs under each dot, so the box is padded for it.
  const width = right - left + 80;
  const height = bottom - top + 80;
  const k = Math.max(
    MIN_ZOOM,
    Math.min(FIT_MAX_ZOOM, (FIT_MARGIN * size.width) / width, (FIT_MARGIN * size.height) / height),
  );
  return { x: (-(left + right) / 2) * k, y: (-(top + bottom) / 2) * k, k };
}

/** The surface's size in pixels, so the origin sits in its middle. */
function useSize(target: { current: Element | null }) {
  const [size, setSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const element = target.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  return size;
}

type Gesture =
  | { readonly kind: 'pan'; readonly from: Point; readonly view: View }
  | { readonly kind: 'drag'; readonly id: VaultPath; readonly from: Point; moved: boolean };

/** Panning the ground, dragging a note, and telling a click on a note from a drag. */
function useGestures({
  view,
  setView,
  toGraph,
  drag,
  onOpen,
}: {
  view: View;
  setView: (view: View) => void;
  toGraph: (event: { clientX: number; clientY: number }) => Point;
  drag: (id: string, to: Point | null) => void;
  onOpen: (path: VaultPath, request: OpenRequest) => void;
}) {
  const gesture = useRef<Gesture | null>(null);
  const capture = (event: PointerEvent<Element>) => {
    // jsdom and some pointer types cannot capture; the gesture still works while over the surface.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  return {
    startPan: (event: PointerEvent<SVGSVGElement>) => {
      if (gesture.current !== null) return;
      capture(event);
      gesture.current = { kind: 'pan', from: { x: event.clientX, y: event.clientY }, view };
    },
    startDrag: (event: PointerEvent<SVGGElement>, id: VaultPath) => {
      event.stopPropagation();
      capture(event);
      gesture.current = {
        kind: 'drag',
        id,
        from: { x: event.clientX, y: event.clientY },
        moved: false,
      };
    },
    move: (event: PointerEvent<SVGSVGElement>) => {
      const now = gesture.current;
      if (now === null) return;
      const dx = event.clientX - now.from.x;
      const dy = event.clientY - now.from.y;
      if (now.kind === 'pan') {
        setView({ ...now.view, x: now.view.x + dx, y: now.view.y + dy });
      } else if (now.moved || Math.hypot(dx, dy) > CLICK_SLOP) {
        now.moved = true;
        drag(now.id, toGraph(event));
      }
    },
    end: (event: PointerEvent<SVGSVGElement>) => {
      const now = gesture.current;
      gesture.current = null;
      if (now?.kind !== 'drag') return;
      if (now.moved) drag(now.id, null);
      else if (event.type === 'pointerup')
        onOpen(now.id, { split: event.metaKey || event.ctrlKey });
    },
  };
}

function Edge({
  edge,
  from,
  to,
  dim,
  labelled,
  onHover,
}: {
  edge: GraphEdge;
  from: Point | undefined;
  to: Point | undefined;
  dim: boolean;
  labelled: boolean;
  onHover: (on: boolean) => void;
}) {
  if (from === undefined || to === undefined) return null;
  const className = [
    'graph__edge',
    edge.kind === 'relation' ? 'graph__edge--relation' : '',
    dim ? 'graph__edge--dim' : '',
  ].join(' ');
  return (
    <g
      className={className}
      data-edge={edge.kind}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <line className="graph__edge-line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      {/* A wide invisible stroke, so a thin dashed line can be pointed at. */}
      <line className="graph__edge-hit" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      {edge.label !== null && <title>{edge.label}</title>}
      {edge.label !== null && labelled && (
        <text className="graph__edge-label" x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 4}>
          {edge.label}
        </text>
      )}
    </g>
  );
}

function Node({
  node,
  at,
  tone,
  centre,
  dim,
  labelled,
  onHover,
  onPointerDown,
}: {
  node: GraphNode;
  at: Point | undefined;
  tone: StatusTone | null;
  centre: boolean;
  dim: boolean;
  labelled: boolean;
  onHover: (on: boolean) => void;
  onPointerDown: (event: PointerEvent<SVGGElement>) => void;
}) {
  if (at === undefined) return null;
  const radius = nodeRadius(node.degree);
  const className = [
    'graph__node',
    centre ? 'graph__node--centre' : '',
    dim ? 'graph__node--dim' : '',
  ].join(' ');
  return (
    <g
      className={className}
      data-path={node.path}
      data-tone={tone ?? 'none'}
      transform={`translate(${at.x} ${at.y})`}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onPointerDown={onPointerDown}
    >
      <circle
        className="graph__dot"
        r={radius}
        style={{ fill: tone === null ? 'var(--graph-untyped)' : `var(--status-${tone}-dot)` }}
      />
      <title>{node.title}</title>
      {labelled && (
        <text className="graph__label" y={radius + 13}>
          {node.title}
        </text>
      )}
    </g>
  );
}
