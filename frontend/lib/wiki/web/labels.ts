import { stableSorted } from '@/lib/sort';

import { WIKI_WEB_FORCES, WIKI_WEB_LABELS } from './forces';

/** Splits a title into the characters a reader sees, whatever they are made of. */
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * A title as the web shows it: one longer than `maxLength` characters is cut to its first
 * `maxLength − 1` and an ellipsis, so a long title can't crowd out its neighbours' names. The
 * link's accessible name stays the full title. Characters are counted as a reader sees them
 * (an emoji or an accented letter is one, however many code points it takes), so a cut never
 * lands inside one.
 */
export function truncateName(title: string): string {
  const characters = [...graphemes.segment(title)];
  if (characters.length <= WIKI_WEB_LABELS.maxLength) return title;
  const kept = characters.slice(0, WIKI_WEB_LABELS.maxLength - 1);
  return `${kept.map(({ segment }) => segment).join('')}…`;
}

/** One dot as the labels see it. `x` and `y` are on the STAGE, in screen pixels. */
export interface LabelNode {
  id: string;
  /** The dot's centre on the stage. */
  x: number;
  y: number;
  /** The dot's radius in screen pixels. */
  radius: number;
  /** The measured width of the dot's name, in screen pixels — measured by the caller. */
  width: number;
  degree: number;
}

/**
 * Where a name's box sits: its top-left corner relative to its dot's centre. The box is the
 * name's measured width wide and `lineHeight` tall.
 */
export interface LabelPlacement {
  dx: number;
  dy: number;
}

/**
 * How far to the side of the lit dot a neighbour must lie (as the sine of its direction from
 * the lit dot, out of 1) before its name is set beside it rather than under or over it.
 */
const SIDEWAYS = 0.35;

/**
 * A name's importance, most first: the lit dot's, then the lit dot's neighbours', then every
 * other name. A dot that is several of these takes the first.
 */
const ROLE = { lit: 0, neighbour: 1, other: 2 } as const;
type Role = (typeof ROLE)[keyof typeof ROLE];

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Whether two boxes share any area: boxes that merely touch don't. */
const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** An ordinary name: centred under its dot, a gap below the dot's edge. */
function under(node: LabelNode): LabelPlacement {
  return { dx: -node.width / 2, dy: node.radius + WIKI_WEB_LABELS.gap };
}

/**
 * A neighbour's name, set outward from the `lit` dot so it reads as pointing away from the
 * dot the reader is looking at, and never back across the web toward it. The anchor is the
 * point just past the neighbour's own dot on the far side: a radius and a gap along the line from
 * the lit dot. A neighbour well to the right starts its name there, one well to the left ends
 * it there, and one nearer straight above or below centres the name there — under the anchor
 * when it lies below the lit dot, over it when above. A neighbour on the lit dot's own spot has
 * no far side, and is set as an ordinary name.
 */
function outward(node: LabelNode, lit: LabelNode): LabelPlacement {
  const across = node.x - lit.x;
  const down = node.y - lit.y;
  const length = Math.hypot(across, down);
  if (length === 0) return under(node);

  const reach = node.radius + WIKI_WEB_LABELS.gap;
  const anchor = { x: (across / length) * reach, y: (down / length) * reach };
  const middle = WIKI_WEB_LABELS.lineHeight / 2;
  if (across / length > SIDEWAYS) return { dx: anchor.x, dy: anchor.y - middle };
  if (across / length < -SIDEWAYS) return { dx: anchor.x - node.width, dy: anchor.y - middle };
  return {
    dx: anchor.x - node.width / 2,
    dy: down >= 0 ? anchor.y : anchor.y - WIKI_WEB_LABELS.lineHeight,
  };
}

/**
 * `placement` kept inside a stage `room` wide, so a dot near a side keeps a readable name. A name
 * that fits stays put. One that doesn't is first mirrored to the other side of its dot — an
 * outward name that would run off the stage starts beside its dot instead of ending there, rather
 * than being slid back over the dot — and a centred name mirrors onto itself. Failing that, it is
 * moved sideways the least that brings it inside; a name wider than the stage keeps its start.
 */
function kept(node: LabelNode, placement: LabelPlacement, room: number): LabelPlacement {
  const fits = (dx: number) => node.x + dx >= 0 && node.x + dx + node.width <= room;
  if (fits(placement.dx)) return placement;
  const mirrored = -placement.dx - node.width;
  if (fits(mirrored)) return { dx: mirrored, dy: placement.dy };
  const left = node.x + placement.dx;
  const inside = Math.max(0, Math.min(left, room - node.width));
  return { dx: placement.dx + (inside - left), dy: placement.dy };
}

/** How names are ordered for placing: role first, then degree (most links first), then id. */
function byImportance(a: { node: LabelNode; role: Role }, b: { node: LabelNode; role: Role }) {
  if (a.role !== b.role) return a.role - b.role;
  if (a.node.degree !== b.node.degree) return b.node.degree - a.node.degree;
  if (a.node.id < b.node.id) return -1;
  return a.node.id > b.node.id ? 1 : 0;
}

/**
 * Which names show, and where — all in screen pixels, since names don't scale with the view.
 * Widths come in measured, so this stays pure. The result holds a placement for each name
 * that SHOWS; a dot absent from it has no name on screen.
 *
 * `litId` is the dot whose neighbourhood is lit — the hovered or keyboard-focused dot, or the
 * day's concept at rest; the caller decides — and `neighbours` its neighbours' ids. The day's
 * concept has no place of its own here: while another dot is lit it is named only as any other
 * dot would be. The candidates are the lit dot, its neighbours and, once `scale` reaches
 * `allNamesScale`, every dot whose centre is on the stage. A neighbour's name is set outward
 * from the lit dot ({@link outward}); every other name centres under its dot. A name that would cross the
 * stage's left or right side is kept inside ({@link kept}).
 *
 * Names are placed greedily, most important first — by role, then most links, then id, so the
 * outcome never depends on the order the dots come in — and a name whose box overlaps one already
 * placed is hidden. The lit dot is placed first, so its name is never the one hidden.
 */
export function placeLabels(input: {
  nodes: readonly LabelNode[];
  litId: string | null;
  neighbours: ReadonlySet<string>;
  scale: number;
  stage: { width: number; height: number };
}): Map<string, LabelPlacement> {
  const { nodes, litId, neighbours, scale, stage } = input;
  const lit = litId === null ? undefined : nodes.find((node) => node.id === litId);
  const everyone = scale >= WIKI_WEB_FORCES.allNamesScale;
  const onStage = (node: LabelNode) =>
    node.x >= 0 && node.x <= stage.width && node.y >= 0 && node.y <= stage.height;

  const candidates = nodes.flatMap((node) => {
    const role = roleOf(node);
    return role === undefined ? [] : [{ node, role }];
  });

  function roleOf(node: LabelNode): Role | undefined {
    if (node.id === litId) return ROLE.lit;
    if (neighbours.has(node.id)) return ROLE.neighbour;
    return everyone && onStage(node) ? ROLE.other : undefined;
  }

  const placements = new Map<string, LabelPlacement>();
  const taken: Box[] = [];
  for (const { node, role } of stableSorted(candidates, byImportance)) {
    const wanted = role === ROLE.neighbour && lit ? outward(node, lit) : under(node);
    const placement = kept(node, wanted, stage.width);
    const left = node.x + placement.dx;
    const top = node.y + placement.dy;
    const box = { left, top, right: left + node.width, bottom: top + WIKI_WEB_LABELS.lineHeight };
    if (taken.some((other) => overlaps(box, other))) continue;
    taken.push(box);
    placements.set(node.id, placement);
  }
  return placements;
}
