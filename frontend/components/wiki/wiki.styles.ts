import { MODULE_ACCENT } from '@/lib/modules';
import { cn } from '@/lib/utils';

/**
 * The reading room's chrome outside the rendered body — the index rows, the page's eyebrow and
 * title — kept in one place so the index, the search groups and the page's "Linked from" list
 * share one row geometry. Group headings use the shared `SECTION_HEADING_CLASS`
 * (`lib/ui/section-heading-class.ts`); the body's own prose and link treatments live in
 * `wiki-markdown.styles.ts`.
 */

/** The count beside a section's heading. */
export const groupCountClass = 'ml-2 font-normal tabular-nums text-muted-foreground/70';

/** One page row: the Reader row's padding, radius and hover wash, as a whole-row link. */
export const pageRowClass = cn(
  'block rounded-lg px-3 py-2',
  'transition-colors duration-100 motion-reduce:transition-none hover:bg-secondary/25',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);

/** A row's title line: the title, then (in search results) its section chip. */
export const pageRowTitleClass =
  'flex flex-wrap items-center gap-2 text-sm font-medium text-foreground';

/** A row's second line: the summary, or a body-search snippet. */
export const pageRowSummaryClass = 'mt-0.5 block text-sm text-muted-foreground';

/** A matched word inside a snippet: a violet wash at 22%, text kept at full contrast. */
export const snippetMarkClass = 'rounded-sm bg-accent-violet/[0.22] px-0.5 text-foreground';

/** A muted status line inside a group — "Searching page text…", "Couldn't search page text". */
export const statusLineClass = 'flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground';

/** The body slot's loading line — the status line without a row's inset, flush with the prose. */
export const bodyStatusClass = 'flex items-center gap-2 py-2 text-sm text-muted-foreground';

/** The page's section eyebrow, "Concept", in the module's violet. */
export const eyebrowClass = cn(
  'text-xs font-semibold uppercase tracking-widest',
  MODULE_ACCENT.wiki.text,
);

/** The page's title, in the display serif. */
export const pageTitleClass = 'font-serif text-3xl leading-tight text-foreground';

/** The back link above the page: quiet until hovered. */
export const backLinkClass =
  'text-sm text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none';
