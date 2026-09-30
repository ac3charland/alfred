import * as React from 'react';

import { cn } from '@/lib/utils';

interface SurfaceCardProperties {
  /**
   * The card's heading. Omit it entirely for a card whose contents carry their own header —
   * a linked pane header, say, which has to span the whole row to be clickable.
   */
  title?: string;
  /** A secondary line beside the title, baseline-aligned and pushed to the far end. */
  detail?: string;
  /**
   * A control that ends the header, after the detail — a ⋯ menu trigger, say. Part of the
   * header row, so it needs a `title` to appear.
   */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * The app's surface card: a bordered, rounded panel on the raised surface, with an optional
 * title/detail header row above its contents.
 *
 * Presentation only — the frame every dashboard panel is drawn in, so a panel's file is about
 * what it shows rather than re-deriving the same border, radius, padding and header rhythm.
 */
export function SurfaceCard({ title, detail, action, children, className }: SurfaceCardProperties) {
  const detailLine = detail !== undefined && (
    <p className="text-xs text-muted-foreground">{detail}</p>
  );
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4',
        className,
      )}
    >
      {title !== undefined && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {action === undefined ? (
            detailLine
          ) : (
            // Centred rather than baseline-aligned: the action is a box, not a line of text.
            <div className="flex items-center gap-2">
              {detailLine}
              {action}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
