import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import { MODULE_ACCENT, type ModuleId } from '@/lib/modules';
import { cn } from '@/lib/utils';

interface ViewHeadingProperties {
  /** The view's lucide glyph, shown in the accent circle. */
  icon: LucideIcon;
  /** The view's name, set in the display serif. */
  title: string;
  /** One line saying what the view holds — the answer to "why am I looking at this list?". */
  description: string;
  /**
   * Which module's accent the glyph wears. Defaults to Tasks, the module most of these headings
   * belong to. A heading in another module MUST name its own — the default is silent, and while
   * Tasks and Code shared one hue the Code views rode it without anyone noticing (ALF-219).
   */
  accent?: ModuleId;
}

/**
 * A view's identity block: a circled accent glyph, the serif title, and a one-line description
 * of what the view holds. Every cross-cutting list (By Priority, Today, Week Plan, the Software
 * Factory, Needs human action, the Comms queue) opens with this exact trio, so the app's
 * top-level views read as one family rather than several near-copies of the same class cluster.
 *
 * The glyph's colour comes from the shared module-accent table rather than a per-call
 * `className`, so "which colour is Comms?" has one answer across the switcher, the nav and here.
 *
 * Deliberately owns only the heading itself, not the row it sits in: a view that also carries a
 * control (a Show-completed toggle, a filter menu, a week picker) wraps this in its own
 * `justify-between` header, and a view with nothing beside it renders it bare.
 */
export function ViewHeading({
  icon: Icon,
  title,
  description,
  accent = 'tasks',
}: ViewHeadingProperties) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface',
          MODULE_ACCENT[accent].text,
        )}
      >
        <Icon size={20} />
      </div>
      <div className="flex flex-col">
        <h2 className="font-serif text-2xl text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
