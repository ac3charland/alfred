import type { Json } from '@/lib/database.types';
import type { ReaderFurtherReading, ReaderOverview } from '@/lib/types';

/**
 * The type guard over `reader_posts.overview`'s jsonb — the generated row type is `Json | null`,
 * since Postgres's jsonb column carries no type-level shape, so this is the one place the app
 * trusts a row's `overview` to actually be a {@link ReaderOverview}. A `done` post whose overview
 * fails the guard (a hand-edited row, a future schema change the model wasn't told about) still
 * renders its gist — the Overview verb is simply absent rather than a crash.
 */

function isStringArray(value: Json | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * `ReaderOverview` is a plain interface with no index signature, so it is not structurally
 * assignable to `Json` — TS2677 ("a type predicate's type must be assignable to its parameter's
 * type") on a bare `value is ReaderOverview`. Intersecting in an index signature makes the
 * predicate type itself Json-compatible without touching the shared `ReaderOverview` declaration
 * in `lib/types.ts`; every caller still narrows to (and can treat the result as) a plain
 * `ReaderOverview`, since this type is a structural subtype of it.
 */
type JsonReaderOverview = ReaderOverview & Record<string, Json | undefined>;

export function isReaderOverview(value: Json | null): value is JsonReaderOverview {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { novel_ideas, evidence, argument, who_should_read } = value;
  return (
    isStringArray(novel_ideas) &&
    isStringArray(evidence) &&
    typeof argument === 'string' &&
    typeof who_should_read === 'string'
  );
}

/**
 * A bullet worth showing, in either Novel ideas or Evidence: an empty or whitespace-only one is no
 * bullet, and the wiki send route refuses a blank string — kept in, it would fail every send that
 * Select all fed.
 */
export function isBullet(bullet: string): boolean {
  return bullet.trim() !== '';
}

/** An `http(s)` URL — the only kind a Further reading item may put in an `href`. */
function isWebUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isFurtherReadingItem(value: unknown): value is ReaderFurtherReading {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { url, title, note } = value as Record<string, unknown>;
  return (
    isWebUrl(url) && typeof title === 'string' && title.trim() !== '' && typeof note === 'string'
  );
}

/**
 * A post's Further reading, or an empty list when it has none to show. `further_reading` is
 * optional — absent on every post summarised before the summariser asked for it — so
 * {@link isReaderOverview} never checks it, and a malformed one costs only this section: one bad
 * item and the whole list is treated as absent, since a half-trusted list is not one to send from.
 */
export function furtherReadingOf(overview: ReaderOverview): ReaderFurtherReading[] {
  const further: unknown = overview.further_reading;
  if (!Array.isArray(further)) return [];
  return further.every((item) => isFurtherReadingItem(item)) ? further : [];
}
