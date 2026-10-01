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

/** True for a plain, non-null, non-array object, read as far as a Further reading item's fields. */
function isRecord(value: unknown): value is Partial<Record<keyof ReaderFurtherReading, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether `value` has the SHAPE of a Further reading list: an array whose every entry is an
 * object with string `url`, `title` and `note`. Says nothing about blank strings — see
 * {@link furtherReadingOf}, which also filters those.
 */
export function isFurtherReadingList(value: unknown): value is ReaderFurtherReading[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.url === 'string' &&
        typeof item.title === 'string' &&
        typeof item.note === 'string',
    )
  );
}

/**
 * The Further reading items an overview should show. {@link isReaderOverview} deliberately ignores
 * this key, so a malformed list cannot take the rest of the overview down with it; this is where
 * it is judged instead. A list of the wrong shape (not an array, or an entry missing a string
 * field) yields `[]`, hiding the section. A well-shaped list is filtered item by item: an entry
 * whose url or title is blank after trimming is no link to open or label to show, so it is
 * dropped while its neighbours stay. The note may be empty. An absent key (a summary written
 * under the first prompt version) yields `[]` too.
 */
export function furtherReadingOf(overview: ReaderOverview): ReaderFurtherReading[] {
  const list: unknown = overview.further_reading;
  if (!isFurtherReadingList(list)) return [];
  return list.filter((item) => item.url.trim() !== '' && item.title.trim() !== '');
}
