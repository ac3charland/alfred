import type { CommPersonPriority } from '@/components/comms/settings-format';

/**
 * The class strings the settings surfaces share, kept out of the components so each state is
 * declared once and can be asserted in a unit test rather than eyeballed in JSX.
 *
 * Every string is written out in full — never assembled from a colour name — because Tailwind
 * scans source text for complete utility names and an interpolated class compiles to nothing.
 */

/** A settings card: the bordered surface a person, a rubric version or an example sits on. */
export const SETTINGS_CARD = 'flex flex-col gap-3 rounded-xl border border-border bg-surface p-4';

/**
 * A pruned example. Still legible — the record is the point — but visibly out of the set, so
 * the list reads as "these steer the classifier, those used to".
 */
export const PRUNED_CARD = 'opacity-55';

/**
 * The priority chip. High wears the module's blue, because it is the one value that changes
 * what the classifier does; the other two are labels and dress as labels.
 */
export const PRIORITY_BADGE: Record<CommPersonPriority, string> = {
  high: 'border border-accent-blue/50 text-accent-blue',
  normal: 'border border-border/70 text-muted-foreground',
  low: 'border border-border/70 text-muted-foreground/60',
};

/** A handle chip — an address or number, with its remove control sitting inside the pill. */
export const HANDLE_CHIP =
  'inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-xs text-muted-foreground';

/** A small caption above a group of controls. */
export const SETTINGS_CAPTION =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground/70';

/** The version stamps on an example card — monospaced so `v3` and `v12` line up down the list. */
export const VERSION_STAMP = 'font-mono text-[11px] text-muted-foreground/70';
