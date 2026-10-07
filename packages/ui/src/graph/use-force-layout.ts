import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { nodeRadius, type VaultGraph } from '@atlas/domain';

interface LaidNode extends SimulationNodeDatum {
  readonly id: string;
  readonly radius: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Ticks run before the first paint, so the graph opens settled rather than exploding outwards. */
const WARM_TICKS = 160;

/**
 * The notes and links a layout depends on, as one string: a graph rebuilt
 * with the same ones — which the index does on every save — has the same key.
 */
function shapeOf(graph: VaultGraph): string {
  const nodes = graph.nodes.map((node) => `${node.path}:${node.degree}`).sort();
  const edges = graph.edges.map((edge) => `${edge.source}>${edge.target}`).sort();
  return JSON.stringify([nodes, edges]);
}

/**
 * Where each note sits, worked out by a force simulation — links pull, notes
 * push apart, a gentle pull keeps the whole thing centred on the origin.
 *
 * d3-force seeds its own random source with a constant, so the same graph
 * lays out the same way every time it is opened. The simulation is built
 * again only when the notes or links change; then the notes already placed
 * are held where they are while the new ones settle in around them, so the
 * picture does not jump.
 */
export function useForceLayout(graph: VaultGraph) {
  const [positions, setPositions] = useState<ReadonlyMap<string, Point>>(new Map());
  const simulation = useRef<Simulation<LaidNode, SimulationLinkDatum<LaidNode>> | null>(null);
  const placed = useRef(new Map<string, Point>());
  const shape = shapeOf(graph);
  // Only a change of shape hands the effect a new graph.
  const laidOut = useMemo(() => graph, [shape]);

  useEffect(() => {
    const nodes: LaidNode[] = laidOut.nodes.map((node) => {
      const at = placed.current.get(node.path);
      return {
        id: node.path,
        radius: nodeRadius(node.degree),
        ...(at === undefined ? {} : { x: at.x, y: at.y, fx: at.x, fy: at.y }),
      };
    });
    const links = laidOut.edges.map((edge) => ({ source: edge.source, target: edge.target }));
    const running = forceSimulation(nodes)
      .force(
        'link',
        forceLink<LaidNode, SimulationLinkDatum<LaidNode>>(links)
          .id((node) => node.id)
          .distance(60),
      )
      .force('charge', forceManyBody<LaidNode>().strength(-140).distanceMax(420))
      .force(
        'collide',
        forceCollide<LaidNode>((node) => node.radius + 4),
      )
      .force('x', forceX<LaidNode>(0).strength(0.04))
      .force('y', forceY<LaidNode>(0).strength(0.04))
      .stop();
    running.tick(WARM_TICKS);
    for (const node of nodes) {
      node.fx = null;
      node.fy = null;
    }

    const publish = () => {
      const next = new Map(nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
      placed.current = next;
      setPositions(next);
    };
    publish();
    running.on('tick', publish);
    simulation.current = running;
    return () => {
      running.stop();
      simulation.current = null;
    };
  }, [laidOut]);

  /** Holds a note where it is dragged to, and lets the rest settle around it. */
  const drag = (id: string, to: Point | null) => {
    const running = simulation.current;
    const node = running?.nodes().find((each) => each.id === id);
    if (running === undefined || running === null || node === undefined) return;
    node.fx = to?.x ?? null;
    node.fy = to?.y ?? null;
    if (to !== null) running.alphaTarget(0.25).restart();
    else running.alphaTarget(0);
  };

  return { positions, drag };
}
