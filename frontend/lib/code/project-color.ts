import type { Project } from '@/lib/types';

/**
 * Per-project colour from the glowing accent palette (ALF-50). Projects have no stored colour;
 * one is assigned deterministically by the project's position in the ProjectNav order
 * (`getProjects` → oldest-first), cycling through the palette so adjacent projects differ. The
 * mapping is positional, not hashed, so a small backlog reads as a clean 1-blue / 2-amber /
 * 3-green / 4-teal sequence rather than a scatter of near-collisions.
 *
 * The single source of the project→colour rule: the backlog badge and the ProjectNav icon both
 * resolve their colour through here so a project wears the same colour everywhere.
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
 * The colour for `projectId`, resolved from its slot in the ordered project list. An id absent
 * from the list (should not happen for a seeded story) falls back to the first palette colour.
 */
export function projectColorFor(projects: Project[], projectId: string | null): ProjectColor {
  return projectColorAt(projects.findIndex((project) => project.id === projectId));
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

/** Tinted-pill classes (background + text) for a project badge in the given colour. */
export function projectBadgeClasses(color: ProjectColor): string {
  return PROJECT_BADGE_CLASS[color];
}

/** Text-colour class for a project glyph (the ProjectNav branch icon) in the given colour. */
export function projectTextClasses(color: ProjectColor): string {
  return PROJECT_TEXT_CLASS[color];
}
