import { type Point, WIKI_WEB_FORCES } from './forces';

/**
 * How the web's world sits on the stage: `screen = world × scale + (x, y)`. What
 * {@link fitView} returns, and what zoom and pan change; the reader's zoom and pan hold until the
 * index changes or the window resizes. It moves dot CENTRES only — the dots and their names are
 * drawn at a fixed size in screen pixels, so nothing here scales them.
 */
export interface View {
  scale: number;
  x: number;
  y: number;
}

/** How far a press may wander, in screen pixels, and still be a click. */
export const DRAG_THRESHOLD = 4;

/** Whether a press that went down at `start` and is now at `point` has become a drag. */
export function movedPastThreshold(start: Point, point: Point): boolean {
  return Math.hypot(point.x - start.x, point.y - start.y) > DRAG_THRESHOLD;
}

/** A point in the world, mapped through the view onto the stage. */
export function toScreen(view: View, point: Point): Point {
  return { x: point.x * view.scale + view.x, y: point.y * view.scale + view.y };
}

/** A point on the stage, mapped back through the view into the world. */
export function toWorld(view: View, point: Point): Point {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

/**
 * The view that fits every dot into the stage. `points` are the dots' centres in the world.
 * Their bounding box is scaled so it sits `fitPadding` screen pixels inside the stage on every
 * side, with `labelAllowance` more below it for the lowest dot's name — never above 1:1, so a
 * small web stays at full size, and never below `minScale`, past which the web stops shrinking
 * and overflows. The box and its allowance are then centred on the stage. Dots and names keep
 * their screen size at every scale, so the padding is in screen pixels, not world ones: a
 * dot on the edge of the box still has its whole circle and a margin inside the stage.
 *
 * An axis the dots have no extent on (a row, a column) has nothing to fit and doesn't
 * constrain the scale; the other decides.
 *
 * With no dots there is nothing to fit, and with one there is nothing to fit it to: either way
 * the view is 1:1 with that dot — or the world's origin, where the sim centres the web — at the
 * exact middle of the stage.
 */
export function fitView(points: readonly Point[], stage: { width: number; height: number }): View {
  const [only] = points;
  if (points.length <= 1) {
    const centre = only ?? { x: 0, y: 0 };
    return { scale: 1, x: stage.width / 2 - centre.x, y: stage.height / 2 - centre.y };
  }

  const { fitPadding, labelAllowance, minScale } = WIKI_WEB_FORCES;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const [left, right] = [Math.min(...xs), Math.max(...xs)];
  const [top, bottom] = [Math.min(...ys), Math.max(...ys)];

  const acrossFit =
    right > left ? (stage.width - 2 * fitPadding) / (right - left) : Number.POSITIVE_INFINITY;
  const downFit =
    bottom > top
      ? (stage.height - 2 * fitPadding - labelAllowance) / (bottom - top)
      : Number.POSITIVE_INFINITY;
  const scale = Math.min(1, Math.max(minScale, Math.min(acrossFit, downFit)));
  return {
    scale,
    x: stage.width / 2 - ((left + right) / 2) * scale,
    y: stage.height / 2 - ((top + bottom) / 2) * scale - labelAllowance / 2,
  };
}

/**
 * `view` moved `share` of the way (0 to 1) to `target`, scale and all. Every world point
 * then moves in a straight line on the stage, as the view goes from one to the other.
 */
export function glideTo(view: View, target: View, share: number): View {
  return {
    scale: view.scale + (target.scale - view.scale) * share,
    x: view.x + (target.x - view.x) * share,
    y: view.y + (target.y - view.y) * share,
  };
}

/**
 * How far along one axis to move a dot to bring it inside a stage `room` long with `padding`
 * to spare: `start` is where its circle begins on the stage and `length` how long it is.
 * Nothing when it is inside already. A dot too long for the room shows its start.
 */
function revealShift(start: number, length: number, room: number, padding: number): number {
  if (start >= 0 && start + length <= room) return 0;
  if (start < 0) return padding - start;
  return Math.max(room - padding - (start + length), padding - start);
}

/**
 * `view` moved, at the same scale, the least that brings the dot centred at `point` in the world
 * fully inside the stage with `padding` to spare — or `view` itself when the dot is inside the
 * stage already, however near an edge. The dot is a circle of `radius` screen pixels, whatever
 * the scale, so it is the circle that is brought in, not a scaled one.
 */
export function revealNode(
  view: View,
  point: Point,
  radius: number,
  stage: { width: number; height: number },
  padding: number,
): View {
  const centre = toScreen(view, point);
  const across = revealShift(centre.x - radius, 2 * radius, stage.width, padding);
  const down = revealShift(centre.y - radius, 2 * radius, stage.height, padding);
  return across === 0 && down === 0 ? view : { ...view, x: view.x + across, y: view.y + down };
}

const clampScale = (scale: number): number =>
  Math.min(WIKI_WEB_FORCES.maxScale, Math.max(WIKI_WEB_FORCES.minScale, scale));

/**
 * `view` shown at `scale`, clamped to the zoom's limits, with the world point that was under
 * `anchor` on the stage now under `target` — the same spot, for a zoom about the pointer.
 */
function scaleAbout(view: View, scale: number, anchor: Point, target: Point = anchor): View {
  const world = toWorld(view, anchor);
  const clamped = clampScale(scale);
  return { scale: clamped, x: target.x - world.x * clamped, y: target.y - world.y * clamped };
}

/**
 * `view` zoomed by `factor` about `point` on the stage: the world point under the pointer
 * stays under it. Never past `minScale` or `maxScale`.
 */
export function zoomAt(view: View, point: Point, factor: number): View {
  return scaleAbout(view, view.scale * factor, point);
}

/** What one wheel event's `deltaY` measures in: pixels, lines or pages. */
const DELTA_MODE = { lines: 1, pages: 2 } as const;

/**
 * How much one wheel event zooms by. Turning the wheel toward the reader zooms out, and a
 * notch of a mouse wheel (100 px) is a step of about an eighth; a line is 25 px and a page
 * 500. A trackpad pinch arrives as a wheel with `ctrlKey` set and far smaller deltas, so it
 * counts ten times over. The rates are d3-zoom's.
 */
export function wheelZoom(event: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  const unit =
    event.deltaMode === DELTA_MODE.lines ? 0.05 : event.deltaMode === DELTA_MODE.pages ? 1 : 0.002;
  return 2 ** (-event.deltaY * unit * (event.ctrlKey ? 10 : 1));
}

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * The view a two-finger pinch has reached: `start` scaled by how far the fingers have
 * spread since they went down at `from`, and moved so the world point that was between them
 * is between them still at `to`. Within the zoom's limits.
 */
export function pinchView(
  start: View,
  from: readonly [Point, Point],
  to: readonly [Point, Point],
): View {
  const spread = distance(...from);
  const scale = spread > 0 ? (start.scale * distance(...to)) / spread : start.scale;
  return scaleAbout(start, scale, midpoint(...from), midpoint(...to));
}
