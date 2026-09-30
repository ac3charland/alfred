import {
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force';

import { forceBounds } from './bounds';
import { type Point, WIKI_WEB_FORCES, dotRadius } from './forces';
import type { WikiWebEdge, WikiWebNode } from './graph';

/** A dot in the sim. `x` and `y` are the dot's CENTRE in world pixels; `radius` is screen-constant. */
export interface WikiSimNode extends SimulationNodeDatum {
  /** The page path — the same id the rest of the web uses. */
  id: string;
  /** {@link dotRadius} of the page's degree, in px: the dot's own size, before any padding. */
  radius: number;
}

/** The angle between successive points of a sunflower spiral, which never line up. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** The widest a dot ever gets, which is `dotRadius`'s ceiling: the room the world must always hold. */
const WIDEST_DOT = dotRadius(Number.POSITIVE_INFINITY);

/**
 * How near two dot centres may sit and still leave a widest dot's room to each: the spacing of
 * the spiral a dot with nothing to link to is placed along.
 */
const CLEAR_DISTANCE = 2 * (WIDEST_DOT + WIKI_WEB_FORCES.collidePadding);

/** A stage's aspect (width over height), or 1 when it has no measurable one (not yet laid out). */
const aspectOf = (aspect: number): number => (Number.isFinite(aspect) && aspect > 0 ? aspect : 1);

/**
 * The world the sim runs in, centred on (0, 0): `worldCell²` of area per dot, shaped to the
 * stage's `aspect` (width over height). Any less and the collision can't clear every overlap
 * without piling dots along the edges. It is never smaller than one widest dot inside its
 * margins, and a stage with no measurable aspect (not yet laid out) is taken as square.
 */
export function worldSize(nodeCount: number, aspect: number): { width: number; height: number } {
  const shape = aspectOf(aspect);
  const area = nodeCount * WIKI_WEB_FORCES.worldCell ** 2;
  const least = 2 * WIDEST_DOT + 2 * WIKI_WEB_FORCES.boundsMargin;
  return {
    width: Math.max(least, Math.sqrt(area * shape)),
    height: Math.max(least, Math.sqrt(area / shape)),
  };
}

/** d3's own linear congruential generator, seeded, so every run draws the same numbers. */
function seededRandom(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (1_664_525 * state + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

/** Links as d3 takes them: fresh objects, since `forceLink` rewrites their ends in place. */
type WikiLink = SimulationLinkDatum<WikiSimNode>;

/** The id at one end of a link, whether d3 has swapped the id for the node yet or not. */
const endId = (end: string | number | WikiSimNode): string =>
  typeof end === 'object' ? end.id : String(end);

/**
 * The first spot, out along a sunflower spiral from the centre, that is clear of every one of
 * `taken` — a widest dot's room from each. The spiral grows without bound, so a spot is always
 * found.
 */
function freeSpot(taken: readonly Point[]): Point {
  const clear = (spot: Point) =>
    taken.every((other) => Math.hypot(spot.x - other.x, spot.y - other.y) >= CLEAR_DISTANCE);
  let spot: Point = { x: 0, y: 0 };
  for (let turn = 1; !clear(spot); turn += 1) {
    const radius = CLEAR_DISTANCE * Math.sqrt(turn);
    spot = { x: radius * Math.cos(turn * GOLDEN_ANGLE), y: radius * Math.sin(turn * GOLDEN_ANGLE) };
  }
  return spot;
}

/**
 * Where every dot starts on a warm start. A dot with a previous position starts there. A new
 * dot starts just off the centroid of the dots it links to that already have a place — a
 * padding's width away, turned a golden angle further for each new dot so two never land on one
 * spot. That repeats, so a new page that links only to another new one lands beside it once it
 * has a place. A dot that links to nothing takes the first free spot out from the centre.
 */
function startingPositions(
  ids: readonly string[],
  edges: readonly WikiWebEdge[],
  previous: ReadonlyMap<string, Point>,
): Map<string, Point> {
  const placed = new Map<string, Point>();
  for (const id of ids) {
    const point = previous.get(id);
    if (point) placed.set(id, { x: point.x, y: point.y });
  }

  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const { a, b } of edges) {
    neighbours.get(a)?.push(b);
    neighbours.get(b)?.push(a);
  }

  let waiting = ids.filter((id) => !placed.has(id));
  let seeded = 0;
  for (let progress = true; progress; ) {
    progress = false;
    const unplaced: string[] = [];
    for (const id of waiting) {
      const anchors = (neighbours.get(id) ?? []).flatMap((other) => {
        const point = placed.get(other);
        return point ? [point] : [];
      });
      if (anchors.length === 0) {
        unplaced.push(id);
        continue;
      }
      const angle = Math.PI / 4 + seeded * GOLDEN_ANGLE;
      placed.set(id, {
        x: mean(anchors.map((point) => point.x)) + WIKI_WEB_FORCES.collidePadding * Math.cos(angle),
        y: mean(anchors.map((point) => point.y)) + WIKI_WEB_FORCES.collidePadding * Math.sin(angle),
      });
      seeded += 1;
      progress = true;
    }
    waiting = unplaced;
  }

  for (const id of waiting) placed.set(id, freeSpot([...placed.values()]));
  return placed;
}

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * The web's physics over `nodes`, wired by `edges` (undirected, each once), returned STOPPED:
 * the caller drives it, by ticking it headless or by restarting d3's own timer. Each node's id
 * is its page path.
 *
 * Forces: the links, which rest longer when one end is the focus so its neighbours bloom out
 * into a ring with room for their names (d3's default strength, so a hub doesn't over-constrain);
 * many-body charge; a weak pull of every dot toward (0, 0), split by the stage's aspect so the
 * web takes its shape; a further pull of the focus alone toward it — a force, not a pin, so a
 * change of focus glides; d3's circle collision, each dot its own radius plus a padding (a wider
 * one for the focus); and bounds that keep every dot inside a world sized for the wiki
 * ({@link worldSize}) and shaped like the `stage`. Every constant is in {@link WIKI_WEB_FORCES}.
 *
 * Cold, with no `previous` position for any of the dots, it starts at alpha 1 from d3's own
 * spiral. Warm, dots start where `previous` (centres, by id) holds them, new dots start beside
 * what they link to, and it restarts at `restartAlpha` — so a refreshed index or a new day's
 * focus disturbs the map a reader has learned as little as it can.
 *
 * The same input lands the same way every run: d3 draws from a seeded random source here, and
 * is given fresh objects, since it writes positions onto its nodes and rewrites its links. The
 * nodes keep the order they are given in, which decides where d3 first puts them. An edge naming
 * a page that isn't in `nodes` is skipped.
 */
export function createWebSimulation(input: {
  nodes: readonly WikiWebNode[];
  edges: readonly WikiWebEdge[];
  focusId: string | null;
  stage: { width: number; height: number };
  previous?: ReadonlyMap<string, Point>;
}): Simulation<WikiSimNode, undefined> {
  const { nodes: pages, edges, focusId, stage, previous } = input;
  const ids = pages.map((page) => page.path);
  const known = new Set(ids);
  const kept = edges.filter((edge) => known.has(edge.a) && known.has(edge.b));
  const links: WikiLink[] = kept.map((edge) => ({ source: edge.a, target: edge.b }));

  const warm = previous !== undefined && ids.some((id) => previous.has(id));
  const start = warm ? startingPositions(ids, kept, previous) : new Map<string, Point>();
  const nodes: WikiSimNode[] = pages.map((page) => {
    const radius = dotRadius(page.degree);
    const point = start.get(page.path);
    return point ? { id: page.path, radius, x: point.x, y: point.y } : { id: page.path, radius };
  });

  const aspect = aspectOf(stage.width / stage.height);
  const focusPull = (node: WikiSimNode) => (node.id === focusId ? WIKI_WEB_FORCES.focusPull : 0);
  const linkDistance = (link: WikiLink) =>
    focusId !== null && (endId(link.source) === focusId || endId(link.target) === focusId)
      ? WIKI_WEB_FORCES.focusLinkDistance
      : WIKI_WEB_FORCES.linkDistance;
  const collideRadius = (node: WikiSimNode) =>
    node.radius +
    (node.id === focusId ? WIKI_WEB_FORCES.focusCollidePadding : WIKI_WEB_FORCES.collidePadding);
  const world = worldSize(nodes.length, aspect);

  // `forceSimulation` starts d3's timer at once; stop it before anything can tick.
  const simulation = forceSimulation<WikiSimNode>()
    .stop()
    .randomSource(seededRandom())
    .nodes(nodes);
  return simulation
    .force(
      'link',
      forceLink<WikiSimNode, WikiLink>(links)
        .id((node) => node.id)
        .distance(linkDistance),
    )
    .force('charge', forceManyBody<WikiSimNode>().strength(WIKI_WEB_FORCES.charge))
    .force('x', forceX<WikiSimNode>(0).strength(WIKI_WEB_FORCES.centre / aspect))
    .force('y', forceY<WikiSimNode>(0).strength(WIKI_WEB_FORCES.centre * aspect))
    .force('focusX', forceX<WikiSimNode>(0).strength(focusPull))
    .force('focusY', forceY<WikiSimNode>(0).strength(focusPull))
    .force('collide', forceCollide<WikiSimNode>(collideRadius))
    .force('bounds', forceBounds<WikiSimNode>(world, WIKI_WEB_FORCES.boundsMargin))
    .alpha(warm ? WIKI_WEB_FORCES.restartAlpha : 1);
}

/**
 * Tick while `going` holds, but never past the ticks d3 takes to cool from full energy to
 * rest — so a sim whose energy is held up (a drag's alpha target) still returns.
 */
function tickWhile(
  simulation: Simulation<WikiSimNode, undefined>,
  going: () => boolean,
): Simulation<WikiSimNode, undefined> {
  const cooling = Math.ceil(
    Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()),
  );
  for (let ticks = 0; ticks < cooling && going(); ticks += 1) simulation.tick();
  return simulation;
}

/**
 * Tick headless down to `prerollAlpha`, so a first paint opens on a web that is nearly
 * settled and only relaxes into place. A warm start is already there and doesn't move.
 */
export function prerollSimulation(
  simulation: Simulation<WikiSimNode, undefined>,
): Simulation<WikiSimNode, undefined> {
  return tickWhile(simulation, () => simulation.alpha() > WIKI_WEB_FORCES.prerollAlpha);
}

/**
 * Tick headless until the sim is at rest — where d3's own timer would stop — for reduced
 * motion, which paints only the settled web, and for tests. Returns after a full cooling's
 * worth of ticks even if the energy is held up.
 */
export function settleSimulation(
  simulation: Simulation<WikiSimNode, undefined>,
): Simulation<WikiSimNode, undefined> {
  return tickWhile(simulation, () => simulation.alpha() >= simulation.alphaMin());
}

/** Every dot's centre, by id: what the view draws, and the `previous` of the next sim. */
export function positionsOf(simulation: Simulation<WikiSimNode, undefined>): Map<string, Point> {
  return new Map(
    simulation.nodes().map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }] as const),
  );
}
