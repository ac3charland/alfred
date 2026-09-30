import { MODULE_ACCENT } from '@/lib/modules';
import { cn } from '@/lib/utils';

/**
 * The landing's "Concept of the day" card, drawn as the shared surface card with the wiki
 * module's violet on its edge and glow so it reads as the landing's one featured thing. The
 * card's own classes are added to `SurfaceCard`'s frame (`rounded-lg border bg-surface p-4`); the
 * edge colour replaces its neutral border rather than stacking on it.
 */

/**
 * The frame's additions: `relative` anchors the title link's stretched hit area to the card, and
 * the edge brightens on hover, the way any other clickable row answers the pointer.
 */
export const conceptCardClass = cn(
  'relative border-accent-violet/30',
  MODULE_ACCENT.wiki.glow,
  'transition-colors hover:border-accent-violet/60 motion-reduce:transition-none',
);

/** The top row: the eyebrow at the start, the date at the far end. */
export const conceptCardHeaderClass = 'flex items-baseline justify-between gap-3';

/** The date beside the eyebrow. */
export const conceptDateClass = 'shrink-0 text-xs text-muted-foreground';

/**
 * The title, a link whose `::after` covers the whole card (the card is its containing block), so
 * a click anywhere on the card opens the page while the link's accessible name stays the title.
 * `self-start` keeps the focus ring hugging the title rather than the card's full width.
 */
export const conceptTitleLinkClass = cn(
  'self-start rounded-sm font-serif text-2xl leading-tight text-foreground',
  "after:absolute after:inset-0 after:content-['']",
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);

/** The one-line summary under the title. */
export const conceptSummaryClass = 'text-sm text-muted-foreground';

/** The row of tag badges, spaced as the page's own tag row is. */
export const conceptTagsClass = 'flex flex-wrap items-center gap-2';
