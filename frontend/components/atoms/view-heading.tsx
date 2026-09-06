import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

interface ViewHeadingProperties {
  /** The view's lucide glyph, shown in the accent circle. */
  icon: LucideIcon;
  /** The view's name, set in the display serif. */
  title: string;
  /** One line saying what the view holds — the answer to "why am I looking at this list?". */
  description: string;
}

/**
 * A view's identity block: a circled accent glyph, the serif title, and a one-line description
 * of what the view holds. Every cross-cutting list (By Priority, Today, Week Plan, the Software
 * Factory, Needs human action) opens with this exact trio, so the app's top-level views read as
 * one family rather than five near-copies of the same class cluster.
 *
 * Deliberately owns only the heading itself, not the row it sits in: a view that also carries a
 * control (a Show-completed toggle, a filter menu, a week picker) wraps this in its own
 * `justify-between` header, and a view with nothing beside it renders it bare.
 */
export function ViewHeading({ icon: Icon, title, description }: ViewHeadingProperties) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-accent-teal">
        <Icon size={20} />
      </div>
      <div className="flex flex-col">
        <h2 className="font-serif text-2xl text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
