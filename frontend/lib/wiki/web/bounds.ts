import type { Force, SimulationNodeDatum } from 'd3-force';

/**
 * Keeps every dot `margin` inside a world of `size`, centred on (0, 0) — the dot's own edge, not
 * its centre, so a hub with a 9 px radius stops sooner than a 3 px leaf and neither is ever
 * half out of the world. Each node's `radius` is read as the sim runs, so a dot that grows
 * takes its new limit at once. A world too small for a dot pins it to the centre rather than
 * flipping its limit negative.
 *
 * A node heading past the edge has its velocity cut so it arrives at the edge instead, and a
 * node already outside — started beside a dot near the edge — is drawn back in, gliding rather
 * than jumping. A held node goes where it is held (d3 puts it at `fx`, `fy` whatever the
 * velocity); once let go, it is drawn back. This runs last, after every other force has had its
 * say. There is no collision here: dots are circles, so d3's own `forceCollide` keeps them apart.
 */
export function forceBounds<Node extends SimulationNodeDatum & { radius: number }>(
  size: { width: number; height: number },
  margin: number,
): Force<Node, undefined> {
  const reachX = size.width / 2 - margin;
  const reachY = size.height / 2 - margin;
  let nodes: readonly Node[] = [];

  function force(): void {
    for (const node of nodes) {
      node.vx = keepWithin(node.x ?? 0, node.vx ?? 0, Math.max(0, reachX - node.radius));
      node.vy = keepWithin(node.y ?? 0, node.vy ?? 0, Math.max(0, reachY - node.radius));
    }
  }

  force.initialize = (initial: Node[]): void => {
    nodes = initial;
  };
  return force;
}

/** The velocity that keeps `position + velocity` within ±`limit`. */
function keepWithin(position: number, velocity: number, limit: number): number {
  const next = position + velocity;
  if (next > limit) return limit - position;
  if (next < -limit) return -limit - position;
  return velocity;
}
