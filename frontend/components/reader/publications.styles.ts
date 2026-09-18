/**
 * The class strings the publications roster's cards use, kept out of the component so each
 * state is declared once and can be pinned in a unit test rather than eyeballed in JSX — the
 * same reasoning as `post-row.styles.ts`'s own placement.
 *
 * The two strings mirror comms' `settings.styles.ts` exactly, by design: a settings card reads
 * the same wherever it sits. They are restated here rather than imported, because
 * `components/comms/` is off limits to this module (CLAUDE.md) and the frontend-architecture
 * skill's shared layer lives in `components/atoms/`, not in another feature module's own
 * directory.
 *
 * Every string is written out in full — never assembled from a colour name — because Tailwind
 * scans source text for complete utility names and an interpolated class compiles to nothing.
 */

/** A roster card: the bordered surface one publication sits on. */
export const PUBLICATION_CARD =
  'flex flex-col gap-3 rounded-xl border border-border bg-surface p-4';

/** A paused publication — still legible, visibly out of the roster's rotation. */
export const PAUSED_CARD = 'opacity-55';
