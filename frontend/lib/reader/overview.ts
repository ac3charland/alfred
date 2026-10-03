import type { Json } from '@/lib/database.types';
import type {
  ReaderAlertCategory,
  ReaderAlertFinding,
  ReaderAlertsOverview,
  ReaderFurtherReading,
  ReaderOverview,
  ReaderRoundupOverview,
  ReaderSummaryKind,
} from '@/lib/types';

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

/** A plain object — not an array, and not null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string that parses as an `http:`/`https:` URL — the only kind a row may link to. */
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
  return (
    isRecord(value) &&
    isWebUrl(value['url']) &&
    typeof value['title'] === 'string' &&
    value['title'].trim() !== '' &&
    typeof value['note'] === 'string'
  );
}

/**
 * An overview's Further reading items, or none. Kept out of {@link isReaderOverview} on purpose:
 * the list is optional (a summary written before it existed has no key), and a malformed one —
 * not an array, or any item without a web URL and a title — hides only this section, never the
 * rest of the overview. Every item is checked because its `url` becomes an `href` the owner
 * clicks, so a `javascript:` value from a hand-edited row must never reach one.
 */
export function furtherReadingOf(value: unknown): ReaderFurtherReading[] {
  if (!Array.isArray(value)) return [];
  const items: unknown[] = value;
  return items.every((item) => isFurtherReadingItem(item)) ? items : [];
}

/**
 * A bullet worth showing, in either Novel ideas or Evidence: an empty or whitespace-only one is no
 * bullet, and the wiki send route refuses a blank string — kept in, it would fail every send that
 * Select all fed.
 */
export function isBullet(bullet: string): boolean {
  return bullet.trim() !== '';
}

/**
 * The kind a post's summary was written under. Null — a summary from before kinds existed, or a
 * post not summarised yet — reads as the essay every such summary is.
 */
export function summaryKindOf(post: { summary_kind: string | null }): ReaderSummaryKind {
  const kind = post.summary_kind;
  return kind === 'roundup' || kind === 'alerts' ? kind : 'essay';
}

/**
 * A post's overview, read by the kind it was SUMMARISED under — never by its publication's current
 * kind, so changing a publication's kind changes no summary already written. `none` when the
 * stored overview fails its kind's guard (a hand-edited row, another kind's shape): the row then
 * renders as a failing essay overview always has — its gist, and a panel of only the footer.
 */
export type PostOverviewOf =
  | { kind: 'essay'; overview: ReaderOverview }
  | { kind: 'roundup'; overview: ReaderRoundupOverview }
  | { kind: 'alerts'; overview: ReaderAlertsOverview }
  | { kind: 'none' };

const ALERT_CATEGORIES: ReadonlySet<unknown> = new Set<ReaderAlertCategory>([
  'sale',
  'security',
  'action',
  'change',
]);

/** One stored finding, its absent deadline read as null; undefined when malformed. */
function alertFindingOf(value: unknown): ReaderAlertFinding | undefined {
  if (!isRecord(value)) return undefined;
  const { category, detail, deadline } = value;
  if (!ALERT_CATEGORIES.has(category) || typeof detail !== 'string') return undefined;
  if (deadline !== undefined && deadline !== null && typeof deadline !== 'string') return undefined;
  return {
    category: category as ReaderAlertCategory,
    detail,
    deadline: typeof deadline === 'string' ? deadline : null,
  };
}

function roundupOf(value: Json | null): ReaderRoundupOverview | undefined {
  if (!isRecord(value) || !isStringArray(value['highlights'])) return undefined;
  return {
    highlights: value['highlights'],
    further_reading: furtherReadingOf(value['further_reading']),
  };
}

function alertsOf(value: Json | null): ReaderAlertsOverview | undefined {
  if (!isRecord(value) || !Array.isArray(value['findings'])) return undefined;
  const findings: ReaderAlertFinding[] = [];
  for (const entry of value['findings'] as unknown[]) {
    const finding = alertFindingOf(entry);
    if (finding === undefined) return undefined;
    findings.push(finding);
  }
  return { findings };
}

export function overviewOf(post: {
  summary_kind: string | null;
  overview: Json | null;
}): PostOverviewOf {
  switch (summaryKindOf(post)) {
    case 'roundup': {
      const overview = roundupOf(post.overview);
      return overview === undefined ? { kind: 'none' } : { kind: 'roundup', overview };
    }
    case 'alerts': {
      const overview = alertsOf(post.overview);
      return overview === undefined ? { kind: 'none' } : { kind: 'alerts', overview };
    }
    case 'essay': {
      return isReaderOverview(post.overview)
        ? { kind: 'essay', overview: post.overview }
        : { kind: 'none' };
    }
  }
}

/**
 * A post's sendable links, whatever its kind: an essay's Further reading or a roundup's Links —
 * stored under one key, so one checklist and one send route serve both. None for Alerts.
 */
export function postFurtherReading(post: {
  summary_kind: string | null;
  overview: Json | null;
}): ReaderFurtherReading[] {
  const read = overviewOf(post);
  switch (read.kind) {
    case 'essay': {
      return furtherReadingOf(read.overview.further_reading);
    }
    case 'roundup': {
      return read.overview.further_reading;
    }
    default: {
      return [];
    }
  }
}
