import type { Project } from '@/lib/types';

/**
 * Per-project colour from the glowing accent palette (ALF-50). A project's colour is its **stored
 * override, else its creation slot**:
 *
 * - **Override.** The owner can pick one of the palette colours from the board toolbar (ALF-188);
 *   it lives in `projects.color`. A pick belongs to that project alone — two projects may share a
 *   colour, and a pick never shifts anyone else's.
 * - **Creation slot (Automatic).** With no pick (`color` NULL), a colour is assigned
 *   deterministically by the project's position in CREATION order (`getProjects` / `useProjects` →
 *   oldest-first), cycling through the palette so adjacent projects differ. This is independent of
 *   any display ordering — e.g. ProjectNav lists projects by its own ranked order
 *   (`useRankedProjects`) but still colours each one by its creation slot, so a project keeps the
 *   same colour even as its rank (and row position) shifts. The mapping is positional, not hashed,
 *   so a small backlog reads as a clean 1-blue / 2-amber / 3-green / 4-red sequence rather than a
 *   scatter of near-collisions.
 *
 * The single source of the project→colour rule: the board title, the backlog badge, the ProjectNav
 * icon, the Dashboard's PR-ratio bar and every other coloured project surface resolve their colour
 * through `projectColorFor` so a project wears the same colour everywhere.
 */

/** The glowing accent palette in assignment order — project #1 is blue, #2 amber, and so on. */
export const PROJECT_COLORS = ['blue', 'amber', 'green', 'red', 'teal'] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

/** The colour for the project at `index` in creation order — round-robin through the palette. */
export function projectColorAt(index: number): ProjectColor {
  // Guard against a negative index (an unknown project, see `projectColorFor`): clamp to 0 so the
  // modulo stays in range rather than indexing off the front of the palette.
  const safeIndex = Math.max(index, 0);
  return PROJECT_COLORS[safeIndex % PROJECT_COLORS.length] ?? PROJECT_COLORS[0];
}

/**
 * Whether a stored value is one of the palette keys. The generated row types `color` as a plain
 * `string | null`, so this narrows it; anything else (e.g. a value from a later, wider palette read
 * by an older client) is treated as no pick rather than trusted.
 */
export function isProjectColor(value: string | null | undefined): value is ProjectColor {
  const palette: readonly (string | null | undefined)[] = PROJECT_COLORS;
  return palette.includes(value);
}

/**
 * The creation-slot colour for `projectId` — what Automatic resolves to, ignoring any stored pick.
 * An id absent from the list (should not happen for a seeded story) falls back to the first
 * palette colour.
 */
export function projectSlotColorFor(projects: Project[], projectId: string | null): ProjectColor {
  return projectColorAt(projects.findIndex((project) => project.id === projectId));
}

/**
 * The colour `projectId` wears: its stored pick when that is a palette key, else its creation-slot
 * colour. `projects` must be the creation-ordered list for the slot fallback to be stable.
 */
export function projectColorFor(projects: Project[], projectId: string | null): ProjectColor {
  const stored = projects.find((project) => project.id === projectId)?.color;
  return isProjectColor(stored) ? stored : projectSlotColorFor(projects, projectId);
}

// Static Tailwind class strings per colour — written out in full (never interpolated) so the
// Tailwind v4 scanner sees every `accent-<colour>` utility and keeps it in the build.
const PROJECT_BADGE_CLASS: Record<ProjectColor, string> = {
  blue: 'bg-accent-blue/15 text-accent-blue',
  amber: 'bg-accent-amber/15 text-accent-amber',
  green: 'bg-accent-green/15 text-accent-green',
  red: 'bg-accent-red/15 text-accent-red',
  teal: 'bg-accent-teal/15 text-accent-teal',
};

const PROJECT_TEXT_CLASS: Record<ProjectColor, string> = {
  blue: 'text-accent-blue',
  amber: 'text-accent-amber',
  green: 'text-accent-green',
  red: 'text-accent-red',
  teal: 'text-accent-teal',
};

const PROJECT_CHIP_CLASS: Record<ProjectColor, string> = {
  blue: 'border-accent-blue/30 bg-accent-blue/10 text-accent-blue',
  amber: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber',
  green: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
  red: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
  teal: 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal',
};

// The board title: the accent as text plus its soft `title-glow-<colour>` halo (globals.css).
const PROJECT_TITLE_CLASS: Record<ProjectColor, string> = {
  blue: 'text-accent-blue title-glow-blue',
  amber: 'text-accent-amber title-glow-amber',
  green: 'text-accent-green title-glow-green',
  red: 'text-accent-red title-glow-red',
  teal: 'text-accent-teal title-glow-teal',
};

const PROJECT_FILL_CLASS: Record<ProjectColor, string> = {
  blue: 'bg-accent-blue',
  amber: 'bg-accent-amber',
  green: 'bg-accent-green',
  red: 'bg-accent-red',
  teal: 'bg-accent-teal',
};

/** Tinted-pill classes (background + text) for a project badge in the given colour. */
export function projectBadgeClasses(color: ProjectColor): string {
  return PROJECT_BADGE_CLASS[color];
}

/** Bordered-chip classes (border + faint fill + text) for a detail chip in the given colour. */
export function projectChipClasses(color: ProjectColor): string {
  return PROJECT_CHIP_CLASS[color];
}

/** Solid-fill class for a project's PR-ratio bar segment and legend dot in the given colour. */
export function projectFillClasses(color: ProjectColor): string {
  return PROJECT_FILL_CLASS[color];
}

/** Text-colour class for a project glyph (the ProjectNav branch icon) in the given colour. */
export function projectTextClasses(color: ProjectColor): string {
  return PROJECT_TEXT_CLASS[color];
}

/** Glowing-text classes for the project board's title in the given colour. */
export function projectTitleClasses(color: ProjectColor): string {
  return PROJECT_TITLE_CLASS[color];
}
