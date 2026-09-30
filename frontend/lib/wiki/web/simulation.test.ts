import { forceSimulation } from 'd3-force';

import { makeWikiPage, toWikiIndexRow, wikiWebFixtureSet } from '@/lib/wiki/fixtures';

import { type Point, WIKI_WEB_FORCES, dotRadius } from './forces';
import { type WikiWebEdge, type WikiWebNode, buildWikiWeb } from './graph';
import {
  createWebSimulation,
  positionsOf,
  prerollSimulation,
  settleSimulation,
  worldSize,
} from './simulation';

const STAGE = { width: 736, height: 440 };

/** The widest a dot gets, in px: the ceiling of `dotRadius`. */
const WIDEST_DOT = 9;

interface WebInput {
  nodes: readonly WikiWebNode[];
  edges: readonly WikiWebEdge[];
}

const pathOf = (stem: string) => `wiki/concepts/${stem}.md`;

/**
 * The web of the concept pages `links` names: each key is a page linking to the stems in its
 * list, and a stem that is only linked to gets a page of its own. Nodes come in index order.
 */
function webOf(links: Readonly<Record<string, readonly string[]>>): WebInput {
  const stems = new Set([...Object.keys(links), ...Object.values(links).flat()]);
  return buildWikiWeb(
    [...stems].map((stem) =>
      toWikiIndexRow(
        makeWikiPage(pathOf(stem), { links: (links[stem] ?? []).map((target) => pathOf(target)) }),
      ),
    ),
  );
}

/** The landing's sample wiki: 52 concepts and entities in recognisable clusters, 67 edges. */
const SAMPLE: WebInput = buildWikiWeb(
  wikiWebFixtureSet().pages.map((page) => toWikiIndexRow(page)),
);

/** The path of the sample page whose file is named `stem`, a concept or an entity. */
function sampleId(stem: string): string {
  const node = SAMPLE.nodes.find((each) => each.path.endsWith(`/${stem}.md`));
  if (!node) throw new Error(`no sample page ${stem}`);
  return node.path;
}

/** The first `count` nodes of `input`, with the edges among them. */
function firstOf(input: WebInput, count: number): WebInput {
  const nodes = input.nodes.slice(0, count);
  const kept = new Set(nodes.map((node) => node.path));
  return { nodes, edges: input.edges.filter(({ a, b }) => kept.has(a) && kept.has(b)) };
}

/**
 * Thirty pages drawn to stress the physics: a hub nine others link to, a chain of ten, and ten
 * that link to nothing.
 */
const SYNTHETIC: WebInput = (() => {
  const numbered = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`);
  const spokes = numbered('spoke', 9);
  const chain = numbered('link', 10);
  return webOf({
    hub: [],
    ...Object.fromEntries(spokes.map((stem) => [stem, ['hub']])),
    ...Object.fromEntries(chain.map((stem, index) => [stem, chain.slice(index + 1, index + 2)])),
    ...Object.fromEntries(numbered('loner', 10).map((stem) => [stem, []])),
  });
})();

/** Where every dot comes to rest, by page path. */
const settle = (
  input: WebInput,
  options: {
    focusId?: string;
    previous?: ReadonlyMap<string, Point>;
    stage?: { width: number; height: number };
  } = {},
): Map<string, Point> =>
  positionsOf(
    settleSimulation(
      createWebSimulation({
        ...input,
        focusId: options.focusId ?? null,
        stage: options.stage ?? STAGE,
        ...(options.previous ? { previous: options.previous } : {}),
      }),
    ),
  );

const radiusOf = (input: WebInput): Map<string, number> =>
  new Map(input.nodes.map((node) => [node.path, dotRadius(node.degree)]));

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const fromCentre = (point: Point | undefined) =>
  point ? Math.hypot(point.x, point.y) : Number.NaN;

/**
 * Pairs of dots closer than the room the sim gives them: each dot's own radius plus its collide
 * padding (the focus keeps more). `slack` is the small shortfall d3's single collision pass may
 * leave at rest.
 */
function crowded(
  positions: ReadonlyMap<string, Point>,
  input: WebInput,
  focusId: string | null = null,
  slack = 1,
): string[] {
  const radii = radiusOf(input);
  const room = (id: string) =>
    (radii.get(id) ?? Number.NaN) +
    (id === focusId ? WIKI_WEB_FORCES.focusCollidePadding : WIKI_WEB_FORCES.collidePadding);
  const entries = [...positions];
  const found: string[] = [];
  for (const [index, [id, a]] of entries.entries()) {
    for (const [other, b] of entries.slice(index + 1)) {
      if (distance(a, b) < room(id) + room(other) - slack) found.push(`${id} / ${other}`);
    }
  }
  return found;
}

/** Dots whose whole circle doesn't sit the bounds margin inside the world, centred on (0, 0). */
function outOfBounds(
  positions: ReadonlyMap<string, Point>,
  input: WebInput,
  stage = STAGE,
): string[] {
  const radii = radiusOf(input);
  const world = worldSize(positions.size, stage.width / stage.height);
  return [...positions]
    .filter(([id, point]) => {
      const reach = WIKI_WEB_FORCES.boundsMargin + (radii.get(id) ?? Number.NaN);
      return (
        Math.abs(point.x) > world.width / 2 - reach + 1e-6 ||
        Math.abs(point.y) > world.height / 2 - reach + 1e-6
      );
    })
    .map(([id]) => id);
}

/** The mean distance moved by the dots `before` holds. */
function meanShift(before: ReadonlyMap<string, Point>, after: ReadonlyMap<string, Point>): number {
  const moved = [...before].map(([id, point]) => {
    const now = after.get(id);
    return now ? distance(point, now) : Number.NaN;
  });
  return moved.reduce((sum, each) => sum + each, 0) / moved.length;
}

/** The ids of the dots `id` shares an edge with. */
const neighboursOf = (input: WebInput, id: string): string[] =>
  input.edges.flatMap(({ a, b }) => (a === id ? [b] : b === id ? [a] : []));

/** The mean distance from `id` to each of its neighbours. */
function meanReach(positions: ReadonlyMap<string, Point>, input: WebInput, id: string): number {
  const centre = positions.get(id);
  const reaches = neighboursOf(input, id).map((other) => {
    const point = positions.get(other);
    return centre && point ? distance(centre, point) : Number.NaN;
  });
  return reaches.reduce((sum, each) => sum + each, 0) / reaches.length;
}

/** The extent of the positions across and down. */
function spread(positions: ReadonlyMap<string, Point>): { across: number; down: number } {
  const xs = [...positions.values()].map((point) => point.x);
  const ys = [...positions.values()].map((point) => point.y);
  return {
    across: Math.max(...xs) - Math.min(...xs),
    down: Math.max(...ys) - Math.min(...ys),
  };
}

describe('createWebSimulation', () => {
  it('runs d3-force under Jest: the sim ticks and cools', () => {
    expect(typeof forceSimulation).toBe('function');
    const simulation = createWebSimulation({
      ...webOf({ a: ['b'] }),
      focusId: null,
      stage: STAGE,
    });

    simulation.tick();

    expect(simulation.alpha()).toBeLessThan(1);
    expect(
      simulation.nodes().every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)),
    ).toBe(true);
  });

  it('returns the sim stopped, at full energy on a cold start, for the caller to drive', async () => {
    const simulation = createWebSimulation({ ...SAMPLE, focusId: null, stage: STAGE });
    const before = positionsOf(simulation);

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(simulation.alpha()).toBe(1);
    expect(positionsOf(simulation)).toStrictEqual(before);
  });

  it('keeps the nodes in the order it is given them, each id its page path and radius its dot', () => {
    const simulation = createWebSimulation({ ...SAMPLE, focusId: null, stage: STAGE });

    expect(simulation.nodes().map((node) => node.id)).toStrictEqual(
      SAMPLE.nodes.map((node) => node.path),
    );
    expect(simulation.nodes().map((node) => node.radius)).toStrictEqual(
      SAMPLE.nodes.map((node) => dotRadius(node.degree)),
    );
  });

  it('lands every dot in the same place on every run', () => {
    expect(settle(SAMPLE)).toStrictEqual(settle(SAMPLE));
    expect(settle(SAMPLE, { focusId: sampleId('habit-loop') })).toStrictEqual(
      settle(SAMPLE, { focusId: sampleId('habit-loop') }),
    );
  });

  it('leaves the nodes and edges it is given untouched, however d3 rewrites its own copies', () => {
    const nodes = SAMPLE.nodes.map((node) => ({ ...node }));
    const edges = SAMPLE.edges.map((edge) => ({ ...edge }));

    settle(SAMPLE);

    expect(SAMPLE.nodes).toStrictEqual(nodes);
    expect(SAMPLE.edges).toStrictEqual(edges);
  });

  it('skips an edge naming a node it was not given, rather than throwing', () => {
    const input = webOf({ a: ['b'], c: [] });
    const withGhost = { ...input, edges: [...input.edges, { a: pathOf('a'), b: pathOf('ghost') }] };

    expect(() => settle(withGhost)).not.toThrow();
    // Skipped, not merely survived: the layout is the one without the edge.
    expect(settle(withGhost)).toStrictEqual(settle(input));
  });

  it('lays out nothing, and a lone dot at the centre', () => {
    expect(settle({ nodes: [], edges: [] }).size).toBe(0);

    const [only] = settle(webOf({ alone: [] })).values();

    expect(fromCentre(only)).toBeLessThan(1);
  });

  it.each([
    ['the 52-page sample wiki', 52, SAMPLE],
    ['a synthetic hub, chain and loners', 30, SYNTHETIC],
    ['a pair of linked pages', 2, webOf({ a: ['b'] })],
    ['a page linked from three', 4, webOf({ a: ['d'], b: ['d'], c: ['d'] })],
  ])('lays out %s (%i dots) with no two dots crowding, inside the world', (_name, count, input) => {
    const positions = settle(input);

    expect(positions.size).toBe(count);
    expect(crowded(positions, input)).toStrictEqual([]);
    expect(outOfBounds(positions, input)).toStrictEqual([]);
  });

  it('keeps every dot clear of the rest and inside the world with a focus too', () => {
    for (const stem of ['habit-loop', 'desirable-difficulty', 'zone-2']) {
      const focusId = sampleId(stem);
      const positions = settle(SAMPLE, { focusId });

      expect(crowded(positions, SAMPLE, focusId)).toStrictEqual([]);
      expect(outOfBounds(positions, SAMPLE)).toStrictEqual([]);
    }
  });

  it('keeps every dot clear of the rest on a phone-shaped stage, at every size of the sample', () => {
    const phone = { width: 390, height: 320 };

    for (const count of [1, 2, 5, 12, 25, 40, 52]) {
      const input = firstOf(SAMPLE, count);
      const positions = settle(input, { stage: phone });

      expect(crowded(positions, input)).toStrictEqual([]);
      expect(outOfBounds(positions, input, phone)).toStrictEqual([]);
    }
  });

  it('spreads thirty leaves round their hub past the link length, since dots can not overlap', () => {
    // On a ring at the link length the leaves would be a few pixels apart: the collision is what
    // holds them a dot and a padding from each other, stretching every link to do it.
    const leaves = Array.from(
      { length: 30 },
      (_, index) => `leaf${String(index).padStart(2, '0')}`,
    );
    const star = webOf({ hub: [], ...Object.fromEntries(leaves.map((stem) => [stem, ['hub']])) });

    const positions = settle(star);

    expect(crowded(positions, star)).toStrictEqual([]);
    expect(outOfBounds(positions, star)).toStrictEqual([]);
    const reach = meanReach(positions, star, pathOf('hub'));
    expect(reach).toBeGreaterThan(WIKI_WEB_FORCES.linkDistance);
  });

  it('gives the focus a wider berth than the rest, so its name has room', () => {
    // Six unlinked dots packed in a row 20 px apart, the focus at one end: every other dot must
    // end up the focus's padded radius away from it, more than the plain padding asks.
    const row = webOf(
      Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p${String(i)}`, []])),
    );
    const packed = new Map(
      row.nodes.map((node, index) => [node.path, { x: index * 20, y: 0 }] as const),
    );
    const focusId = pathOf('p0');

    const positions = settle(row, { focusId, previous: packed });

    expect(crowded(positions, row, focusId)).toStrictEqual([]);
    const focus = positions.get(focusId);
    const nearest = Math.min(
      ...[...positions]
        .filter(([id]) => id !== focusId)
        .map(([, point]) => (focus ? distance(focus, point) : Number.NaN)),
    );
    const plain = 2 * (dotRadius(0) + WIKI_WEB_FORCES.collidePadding);
    expect(nearest).toBeGreaterThan(plain + 1);
  });

  it('shapes the web to the stage: wider than tall on a wide one, taller than wide on a tall one', () => {
    const wide = spread(settle(SAMPLE, { stage: { width: 1200, height: 360 } }));
    const tall = spread(settle(SAMPLE, { stage: { width: 360, height: 1200 } }));

    expect(wide.across).toBeGreaterThan(wide.down);
    expect(tall.down).toBeGreaterThan(tall.across);
  });

  it('pulls a dot toward the centre harder down than across on a wide stage, and the reverse on a tall one', () => {
    const lone = webOf({ alone: [] });
    const drifted = (stage: { width: number; height: number }): Point | undefined => {
      const previous = new Map([[pathOf('alone'), { x: 20, y: 20 }]]);
      const simulation = createWebSimulation({ ...lone, focusId: null, stage, previous });
      for (let tick = 0; tick < 10; tick += 1) simulation.tick();
      return positionsOf(simulation).get(pathOf('alone'));
    };

    const wide = drifted({ width: 900, height: 300 });
    const tall = drifted({ width: 300, height: 900 });

    expect(wide?.y).toBeLessThan(wide?.x ?? Number.NaN);
    expect(tall?.x).toBeLessThan(tall?.y ?? Number.NaN);
  });

  it('pulls the focus nearer the centre than it rests unfocused, as a force and not a pin', () => {
    const unfocused = settle(SAMPLE);

    for (const stem of ['habit-loop', 'zone-2', 'flow', 'peter-attia']) {
      const id = sampleId(stem);
      const simulation = settleSimulation(
        createWebSimulation({ ...SAMPLE, focusId: id, stage: STAGE }),
      );
      const focused = positionsOf(simulation);

      expect(fromCentre(focused.get(id))).toBeLessThan(fromCentre(unfocused.get(id)));
      expect(
        simulation.nodes().every((node) => node.fx === undefined && node.fy === undefined),
      ).toBe(true);
    }
  });

  it("blooms the focus's neighbours out to a ring: farther from it than they rest unfocused", () => {
    const unfocused = settle(SAMPLE);

    for (const stem of ['desirable-difficulty', 'habit-loop', 'john-medina']) {
      const id = sampleId(stem);
      const focused = settle(SAMPLE, { focusId: id });

      expect(neighboursOf(SAMPLE, id).length).toBeGreaterThan(2);
      expect(meanReach(focused, SAMPLE, id)).toBeGreaterThan(meanReach(unfocused, SAMPLE, id));
    }
  });

  it('settles 52 dots headless within the ticks d3 takes to cool from full energy', () => {
    const simulation = createWebSimulation({ ...SAMPLE, focusId: null, stage: STAGE });
    const tick = jest.spyOn(simulation, 'tick');

    settleSimulation(simulation);

    expect(simulation.nodes()).toHaveLength(52);
    expect(simulation.alpha()).toBeLessThan(simulation.alphaMin());
    // d3's alpha decays from 1 to its minimum in 300 ticks.
    expect(tick.mock.calls.length).toBeLessThanOrEqual(300);
  });

  it('treats a stage with no measurable shape as square', () => {
    const unmeasured = settle(SAMPLE, { stage: { width: 0, height: 0 } });

    expect(unmeasured).toStrictEqual(settle(SAMPLE, { stage: { width: 500, height: 500 } }));
    expect(
      [...unmeasured.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    ).toBe(true);
  });
});

describe('createWebSimulation warm-started from where the dots were', () => {
  const before = webOf({ hub: ['a', 'b', 'c'], d: ['e'], f: [] });
  const previous = settle(before);

  /** `before` plus the pages `extra` names, each linking to the stems in its list. */
  const grownWith = (extra: Readonly<Record<string, readonly string[]>>): WebInput =>
    webOf({ hub: ['a', 'b', 'c'], d: ['e'], f: [], ...extra });

  const startOf = (input: WebInput, from: ReadonlyMap<string, Point> = previous) =>
    positionsOf(createWebSimulation({ ...input, focusId: null, stage: STAGE, previous: from }));

  it('starts every dot it knows where it was, at the restart energy', () => {
    const simulation = createWebSimulation({
      ...grownWith({ g: ['a'] }),
      focusId: null,
      stage: STAGE,
      previous,
    });
    const start = positionsOf(simulation);

    expect(simulation.alpha()).toBe(WIKI_WEB_FORCES.restartAlpha);
    expect(previous.size).toBe(before.nodes.length);
    for (const [id, point] of previous) expect(start.get(id)).toStrictEqual(point);
  });

  it('starts a new dot a padding off the one it links to', () => {
    const start = startOf(grownWith({ g: ['a'] }));
    const anchor = previous.get(pathOf('a'));
    const added = start.get(pathOf('g'));

    expect(anchor && added && distance(anchor, added)).toBeCloseTo(
      WIKI_WEB_FORCES.collidePadding,
      6,
    );
  });

  it('starts a new dot a padding off the centre of the dots it links to', () => {
    const start = startOf(grownWith({ g: ['a', 'e', 'f'] }));
    const anchors = ['a', 'e', 'f'].map((stem) => previous.get(pathOf(stem)));
    const centroid = {
      x: anchors.reduce((sum, point) => sum + (point?.x ?? Number.NaN), 0) / anchors.length,
      y: anchors.reduce((sum, point) => sum + (point?.y ?? Number.NaN), 0) / anchors.length,
    };
    const added = start.get(pathOf('g'));

    expect(added && distance(centroid, added)).toBeCloseTo(WIKI_WEB_FORCES.collidePadding, 6);
  });

  it('starts two new dots on one anchor at different spots, each a padding from it', () => {
    const start = startOf(grownWith({ g: ['a'], h: ['a'] }));
    const anchor = previous.get(pathOf('a'));
    const [g, h] = [start.get(pathOf('g')), start.get(pathOf('h'))];

    expect(anchor && g && distance(anchor, g)).toBeCloseTo(WIKI_WEB_FORCES.collidePadding, 6);
    expect(anchor && h && distance(anchor, h)).toBeCloseTo(WIKI_WEB_FORCES.collidePadding, 6);
    // A golden angle apart: nowhere near each other, though both are a padding from the anchor.
    expect(g && h && distance(g, h)).toBeGreaterThan(WIKI_WEB_FORCES.collidePadding);
  });

  it('starts a new dot that links only to another new one beside it, once that has a place', () => {
    // "g" sorts before "h", so it comes first in the nodes: it must wait for "h" to be placed.
    const input = grownWith({ g: ['h'], h: ['a'] });
    const start = startOf(input);
    const [anchor, h, g] = [pathOf('a'), pathOf('h'), pathOf('g')].map((path) => start.get(path));

    expect(input.nodes.findIndex((node) => node.path === pathOf('g'))).toBeLessThan(
      input.nodes.findIndex((node) => node.path === pathOf('h')),
    );
    expect(anchor && h && distance(anchor, h)).toBeCloseTo(WIKI_WEB_FORCES.collidePadding, 6);
    expect(h && g && distance(h, g)).toBeCloseTo(WIKI_WEB_FORCES.collidePadding, 6);
  });

  it('starts a new dot that links to nothing on a spot no dot is near', () => {
    // Every dot it knows is packed round the origin, so the origin itself is not free.
    const packed = new Map(
      before.nodes.map((node, index) => [node.path, { x: index * 10, y: 0 }] as const),
    );
    const start = startOf(grownWith({ alone: [] }), packed);
    const alone = start.get(pathOf('alone'));

    expect(alone).toBeDefined();
    for (const point of packed.values()) {
      expect(alone && distance(alone, point)).toBeGreaterThanOrEqual(
        2 * (WIDEST_DOT + WIKI_WEB_FORCES.collidePadding),
      );
    }
  });

  it('moves the dots already there less than a cold start does', () => {
    const grown = SAMPLE;
    const start = firstOf(SAMPLE, 46);
    const settled = settle(start);

    const cold = settle(grown);
    const warm = settle(grown, { previous: settled });

    expect(meanShift(settled, warm)).toBeLessThan(meanShift(settled, cold));
    expect(crowded(warm, grown)).toStrictEqual([]);
    expect(outOfBounds(warm, grown)).toStrictEqual([]);
  });

  it('keeps every dot clear of the rest and inside the world as the wiki grows warm', () => {
    let known: Map<string, Point> | undefined;

    for (const count of [1, 3, 6, 10, 15, 21, 28, 36, 44, 52]) {
      const input = firstOf(SAMPLE, count);
      known = settle(input, known ? { previous: known } : {});

      expect(crowded(known, input)).toStrictEqual([]);
      expect(outOfBounds(known, input)).toStrictEqual([]);
    }
  });

  it('draws dots back inside a world that has shrunk under them, as an index refresh can leave it', () => {
    // The 52-page web's dots reach far past the edge of the small world six pages make.
    const known = settle(SAMPLE);
    const smaller = firstOf(SAMPLE, 6);
    const world = worldSize(6, STAGE.width / STAGE.height);
    const outside = smaller.nodes.filter(({ path }) => {
      const point = known.get(path);
      return point && Math.abs(point.y) > world.height / 2;
    });
    expect(outside.length).toBeGreaterThan(0);

    const positions = settle(smaller, { previous: known });

    expect(outOfBounds(positions, smaller)).toStrictEqual([]);
  });

  it('comes apart the same way on every run when every dot starts on one spot', () => {
    // On one spot d3 has no direction to push in: it draws from the sim's random source.
    const loners = webOf(
      Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p${String(i)}`, []])),
    );
    const pile = new Map(loners.nodes.map((node) => [node.path, { x: 0, y: 0 }] as const));

    const first = settle(loners, { previous: pile });

    expect(first).toStrictEqual(settle(loners, { previous: pile }));
    expect(crowded(first, loners)).toStrictEqual([]);
  });

  it('lands in the same place on every run', () => {
    const grown = grownWith({ g: ['a'], h: ['g'] });

    expect(settle(grown, { previous })).toStrictEqual(settle(grown, { previous }));
  });

  it('starts cold when none of the positions it is given are for these dots', () => {
    const simulation = createWebSimulation({
      ...before,
      focusId: null,
      stage: STAGE,
      previous: new Map([['gone', { x: 5, y: 5 }]]),
    });

    expect(simulation.alpha()).toBe(1);
  });
});

describe('prerollSimulation', () => {
  it('ticks a cold start headless down to the pre-roll energy, and no further', () => {
    const simulation = createWebSimulation({ ...SAMPLE, focusId: null, stage: STAGE });

    expect(prerollSimulation(simulation)).toBe(simulation);
    expect(simulation.alpha()).toBeLessThanOrEqual(WIKI_WEB_FORCES.prerollAlpha);
    expect(simulation.alpha()).toBeGreaterThan(WIKI_WEB_FORCES.prerollAlpha * 0.95);
  });

  it('leaves a warm start, already at that energy, where it is', () => {
    const simulation = createWebSimulation({
      ...SAMPLE,
      focusId: null,
      stage: STAGE,
      previous: settle(SAMPLE),
    });
    const before = positionsOf(simulation);

    prerollSimulation(simulation);

    expect(positionsOf(simulation)).toStrictEqual(before);
  });
});

describe('settleSimulation', () => {
  it('ticks until the sim is at rest', () => {
    const simulation = createWebSimulation({ ...SAMPLE, focusId: null, stage: STAGE });

    expect(settleSimulation(simulation)).toBe(simulation);
    expect(simulation.alpha()).toBeLessThan(simulation.alphaMin());
  });

  it('stops after a cooling’s worth of ticks while a drag holds the energy up', () => {
    const simulation = createWebSimulation({ ...SAMPLE, focusId: null, stage: STAGE });
    simulation.alphaTarget(WIKI_WEB_FORCES.dragAlphaTarget);

    settleSimulation(simulation);

    expect(simulation.alpha()).toBeGreaterThan(simulation.alphaMin());
  });
});

describe('positionsOf', () => {
  it('reads every dot centre by page path, as copies the sim does not share', () => {
    const simulation = createWebSimulation({ ...SAMPLE, focusId: null, stage: STAGE });
    const positions = positionsOf(simulation);

    for (const node of simulation.nodes()) {
      expect(positions.get(node.id)).toStrictEqual({ x: node.x, y: node.y });
    }
    const [first] = positions.values();
    if (!first) throw new Error('no dots');
    first.x += 1000;
    expect(positionsOf(simulation)).not.toStrictEqual(positions);
  });
});

describe('worldSize', () => {
  const cell = WIKI_WEB_FORCES.worldCell ** 2;

  it('gives each dot a cell of room, shaped to the stage', () => {
    const world = worldSize(10, 16 / 9);

    expect(world.width * world.height).toBeCloseTo(10 * cell, 6);
    expect(world.width / world.height).toBeCloseTo(16 / 9, 9);
  });

  it('grows with every dot', () => {
    const sizes = Array.from({ length: 40 }, (_, index) =>
      worldSize(index + 1, STAGE.width / STAGE.height),
    );

    for (const [index, size] of sizes.slice(1).entries()) {
      expect(size.width).toBeGreaterThan(sizes[index]?.width ?? Infinity);
      expect(size.height).toBeGreaterThan(sizes[index]?.height ?? Infinity);
    }
  });

  it('always has room for one widest dot inside its margins', () => {
    const least = 2 * WIDEST_DOT + 2 * WIKI_WEB_FORCES.boundsMargin;

    for (const [count, aspect] of [
      [0, 1],
      [1, 20],
      [1, 1 / 20],
    ] as const) {
      const world = worldSize(count, aspect);
      expect(world.width).toBeGreaterThanOrEqual(least);
      expect(world.height).toBeGreaterThanOrEqual(least);
    }
    expect(worldSize(0, 1)).toStrictEqual({ width: least, height: least });
  });

  it('shapes a stage with no measurable aspect as a square', () => {
    for (const aspect of [Number.NaN, Infinity, 0, -2]) {
      const world = worldSize(10, aspect);
      expect(world.width).toBeCloseTo(world.height, 9);
    }
  });
});
