/**
 * The class strings the publications roster's cards use, kept out of the component so each
 * state is declared once and can be pinned in a unit test rather than eyeballed in JSX — the
 * same reasoning as `post-row.styles.ts`'s own placement.
 *
 * The two card strings mirror comms' `settings.styles.ts` exactly, by design: a settings card
 * reads the same wherever it sits. They are restated here rather than imported, because this
 * story touches nothing under `components/comms/`, and the frontend-architecture skill's shared
 * layer for cross-module reuse is `components/atoms/`, not another feature module's own
 * directory. Folding these strings (and `publications-settle.ts`'s helper) up into
 * `components/atoms/`, alongside comms' own `AccountDot` → `StatusDot` consolidation, is a named
 * follow-up rather than something this change takes on.
 *
 * Every string is written out in full — never assembled from a colour name — because Tailwind
 * scans source text for complete utility names and an interpolated class compiles to nothing.
 */

/** A roster card: the bordered surface one publication sits on. */
export const PUBLICATION_CARD =
  'flex flex-col gap-3 rounded-xl border border-border bg-surface p-4';

/** A paused publication — still legible, visibly out of the roster's rotation. */
export const PAUSED_CARD = 'opacity-55';

/** The candidates section's small-caps label above its list. */
export const PUBLICATION_CAPTION =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground/70';
