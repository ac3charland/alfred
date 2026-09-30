/**
 * Every tunable of the wiki's web in one object, so tuning the physics edits this file alone.
 * These are starting values, sized for a wiki of 50–200 concepts and entities on a 736 × 440
 * stage; a focus with far more neighbours than the sample's six or seven wants `focusLinkDistance`
 * raised before anything else.
 *
 * - `linkDistance`, `focusLinkDistance` — how far apart an edge holds its two dots, centre to
 *   centre, in world pixels. An edge touching the focus rests at the longer length, so its
 *   neighbours sit out on a ring with room for their names instead of crowding the hub.
 *   Link strength is d3's default (1 over the lesser degree of the two ends), so hubs don't
 *   over-constrain.
 * - `charge` — every dot pushes every other away (many-body; negative repels).
 * - `centre` — a weak pull of every dot toward the world's centre, (0, 0): `centre ÷ aspect`
 *   across and `centre × aspect` down, so the web takes the stage's shape.
 * - `focusPull` — a further pull of the focus alone toward the centre: a force, not a pin, so a
 *   change of focus glides.
 * - `collidePadding`, `focusCollidePadding` — the room a dot keeps beyond its own radius.
 * - `worldCell`, `boundsMargin` — the world holds `worldCell²` of area per dot, shaped to the
 *   stage, and every dot is kept `boundsMargin` inside its edge. A smaller world piles dots
 *   along its edges.
 * - `fitPadding`, `labelAllowance` — the space around the dots when the view fits them, plus
 *   room under the lowest dot for its name.
 * - `minScale`, `maxScale` — the zoom's limits; fitting never goes above 1:1.
 * - `allNamesScale` — the zoom from which every dot on the stage is named.
 * - `prerollAlpha` — where a first paint takes over from the headless pre-roll.
 * - `restartAlpha` — the energy a change (a refreshed index, a new day's focus) restarts at.
 * - `dragAlphaTarget` — the energy the sim holds while a dot is dragged.
 * - `glideShare` — how much of the way to its target the view goes each animated frame.
 */
export const WIKI_WEB_FORCES = {
  linkDistance: 70,
  focusLinkDistance: 150,
  charge: -180,
  centre: 0.06,
  focusPull: 0.1,
  collidePadding: 14,
  focusCollidePadding: 40,
  worldCell: 160,
  boundsMargin: 12,
  fitPadding: 24,
  labelAllowance: 20,
  minScale: 0.25,
  maxScale: 3,
  allNamesScale: 1,
  prerollAlpha: 0.3,
  restartAlpha: 0.3,
  dragAlphaTarget: 0.3,
  glideShare: 0.12,
} as const;

/**
 * How the web's names are set, in screen pixels: names don't scale with the view, so these are
 * what a reader sees at every zoom.
 *
 * - `fontSize`, `focusFontSize` — a name, and the focus's (semibold) name.
 * - `lineHeight` — the height a name's box takes, for culling overlaps.
 * - `gap` — the space between a dot's edge and its name.
 * - `maxLength` — longer titles are cut to this many characters with "…"; the link's accessible
 *   name stays the full title.
 */
export const WIKI_WEB_LABELS = {
  fontSize: 12,
  focusFontSize: 13,
  lineHeight: 16,
  gap: 4,
  maxLength: 28,
} as const;

/** A position in the web's world (or on the stage), in pixels. */
export interface Point {
  x: number;
  y: number;
}

/**
 * A dot's radius in screen pixels: `3 + 1.5·√degree`, held between 3 and 9, so a hub reads as a
 * hub without a 40-link page swallowing its neighbours.
 */
export function dotRadius(degree: number): number {
  return Math.min(9, Math.max(3, 3 + 1.5 * Math.sqrt(Math.max(0, degree))));
}
