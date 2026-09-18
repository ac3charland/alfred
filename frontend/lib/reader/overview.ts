import type { Json } from '@/lib/database.types';
import type { ReaderOverview } from '@/lib/types';

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
