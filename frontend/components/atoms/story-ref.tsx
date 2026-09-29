import * as React from 'react';

import { type ProjectColor, projectTextClasses } from '@/lib/code/project-color';
import { cn } from '@/lib/utils';

interface StoryRefProperties {
  /** The story's project colour, resolved by the caller (`projectColorFor`). */
  color: ProjectColor;
  /** The surface's own sizing (`text-xs`, `text-sm md:text-xs`, …) — the tint is not overridable. */
  className?: string;
  /** The ref text, e.g. `ALF-42`. */
  children: React.ReactNode;
}

/**
 * A story's ref (its ticket slug) as a medium-weight monospace label tinted with the project's
 * colour — the one place that look is written, so every surface that prints a ref (board card and
 * its drag ghost, backlog row, dashboard queue row, detail modal) reads as the same project.
 */
export function StoryRef({ color, className, children }: StoryRefProperties) {
  return (
    <span className={cn('font-mono font-medium', className, projectTextClasses(color))}>
      {children}
    </span>
  );
}
