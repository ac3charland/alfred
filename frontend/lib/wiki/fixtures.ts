import type { WikiPageIndexRow, WikiPageRow, WikiSync } from '@/lib/types';
import { type WikiSection, splitWikiPath } from '@/lib/wiki/sections';

/**
 * Seed builders for the wiki snapshot — one home shared by the unit tests, the stories and the
 * Playwright suite (which re-exports them from `e2e/support/constants`), mirroring
 * `lib/reader/fixtures.ts`. Every default is the migration's own column default or a stated
 * value, so a fixture and a real row differ only where the test says so.
 *
 * Deliberately free of any jest/Playwright import: it is imported from Node (the e2e seed
 * builder), the browser (stories) and Jest test files alike.
 */

/** A fixed instant every fixture stamps, so a story baseline never moves with the clock. */
export const WIKI_FIXTURE_SYNCED_AT = '2026-10-03T14:00:00.000Z';

/** The commit every fixture page claims to come from. */
export const WIKI_FIXTURE_COMMIT = 'c0ffee0000000000000000000000000000000001';

let sequence = 0;

/** Reset the blob-id sequence — call before building a fresh seed. */
export function resetWikiFixtureClock(): void {
  sequence = 0;
}

/** A stable, distinct blob id per page, so a body cache keyed by `path@blob_oid` is exercised. */
function nextBlobOid(): string {
  sequence += 1;
  return `b10b${String(sequence).padStart(36, '0')}`;
}

/** The title a stem implies, the way the wiki's own `titleFor` falls back. */
function titleFromPath(path: string): string {
  const stem = splitWikiPath(path)?.name ?? path;
  return stem.replaceAll('-', ' ').replace(/^./, (first) => first.toUpperCase());
}

/**
 * `overrides[key]`, defaulting only when the key is absent. `??` would also default an
 * explicit `null` — and a fixture caller sometimes needs exactly that, e.g. `{ updated: null }`
 * for a page that has never been touched, or `makeWikiSync({ synced_at: null })` for a sync
 * that has never run.
 */
function withDefault<T extends object, K extends keyof T>(
  overrides: Partial<T>,
  key: K,
  fallback: T[K],
): T[K] {
  return key in overrides ? (overrides as T)[key] : fallback;
}

/**
 * A whole page row, body included. The section is read off the path, so a fixture can never
 * disagree with itself about where it lives.
 */
export function makeWikiPage(path: string, overrides: Partial<WikiPageRow> = {}): WikiPageRow {
  const section: WikiSection = splitWikiPath(path)?.section ?? 'concepts';
  return {
    path,
    section,
    title: overrides.title ?? titleFromPath(path),
    summary: overrides.summary ?? '',
    tags: overrides.tags ?? [],
    sources: overrides.sources ?? [],
    links: overrides.links ?? [],
    created: withDefault(overrides, 'created', '2026-10-01'),
    updated: withDefault(overrides, 'updated', '2026-10-03'),
    body: overrides.body ?? `# ${overrides.title ?? titleFromPath(path)}\n\nA page.\n`,
    parse_error: overrides.parse_error ?? null,
    blob_oid: overrides.blob_oid ?? nextBlobOid(),
    commit_oid: overrides.commit_oid ?? WIKI_FIXTURE_COMMIT,
    synced_at: overrides.synced_at ?? WIKI_FIXTURE_SYNCED_AT,
    // The generated column: Postgres computes it, the mock stores whatever it is handed.
    search: overrides.search ?? null,
  };
}

/** The same page as the index lists it — no body, no search vector. */
export function toWikiIndexRow(page: WikiPageRow): WikiPageIndexRow {
  const { body: _body, search: _search, ...index } = page;
  return index;
}

/** A sync row. Defaults to a healthy sync at the fixture instant with nothing pending. */
export function makeWikiSync(overrides: Partial<WikiSync> = {}): WikiSync {
  return {
    id: 1,
    commit_oid: withDefault(overrides, 'commit_oid', WIKI_FIXTURE_COMMIT),
    synced_at: withDefault(overrides, 'synced_at', WIKI_FIXTURE_SYNCED_AT),
    pending: overrides.pending ?? 0,
    last_error: withDefault(overrides, 'last_error', null),
    last_error_at: withDefault(overrides, 'last_error_at', null),
  };
}

/**
 * A small, linked wiki: two concepts, an entity, two sources and a question, with one page
 * carrying every link kind the renderer distinguishes. Enough for the index to show every
 * section, a page to have backlinks, and a body search to hit a page the titles don't.
 */
export function wikiFixtureSet(): { pages: WikiPageRow[]; sync: WikiSync } {
  const habitStacking = makeWikiPage('wiki/concepts/habit-stacking.md', {
    title: 'Habit stacking',
    summary: 'Anchoring a new behaviour to an existing routine rather than a clock time.',
    tags: ['habits', 'behaviour'],
    sources: [
      'raw/2026/2026-10-01-atomic-habits/excerpts-2026-10-01.md#q-after-i-pour',
      'raw/2026/2026-10-03-why-habits-stick/picks-2026-10-03.md',
    ],
    // The body also links `../concepts/not-yet.md` (implementation intentions), which has no
    // page yet — kept here too, per the wiki_pages.links doc comment: a missing target is still
    // an outbound link, not dropped.
    links: [
      'wiki/entities/james-clear.md',
      'wiki/concepts/habit-loop.md',
      'wiki/concepts/not-yet.md',
    ],
    body: [
      'A new habit survives when its cue is something you already do.',
      '[James Clear](../entities/james-clear.md) names the pattern; the',
      '[habit loop](habit-loop.md) explains why it works.',
      '',
      '> "After I pour my coffee, I will meditate for one minute."',
      '> — [excerpt](../../raw/2026/2026-10-01-atomic-habits/excerpts-2026-10-01.md#q-after-i-pour)',
      '',
      '## Where the sources disagree',
      '',
      "Medina's account leans on [implementation intentions](../concepts/not-yet.md), which has",
      'no page yet. The [source folder](../../raw/2026/2026-10-01-atomic-habits/) holds the rest,',
      'and [the original](https://jamesclear.com/habit-stacking) is online.',
      '',
      '![the loop](../../raw/2026/2026-10-01-atomic-habits/assets/loop.png)',
      '',
      'See also [#where-the-sources-disagree](#where-the-sources-disagree).',
      '',
    ].join('\n'),
  });
  const habitLoop = makeWikiPage('wiki/concepts/habit-loop.md', {
    title: 'Habit loop',
    summary: 'Cue, craving, response, reward — the four-step cycle behind every habit.',
    tags: ['habits'],
    sources: ['raw/2026/2026-10-01-atomic-habits/'],
    links: ['wiki/concepts/habit-stacking.md'],
    body: 'Every habit runs [the same loop](habit-stacking.md) from cue to reward.\n',
  });
  const forgettingCurve = makeWikiPage('wiki/concepts/forgetting-curve.md', {
    title: 'Forgetting curve',
    summary: "Ebbinghaus's decay of recall over time, and why spaced review flattens it.",
    tags: ['memory'],
    sources: ['raw/2026/2026-10-02-brain-rules/'],
    links: [],
    body: 'Recall decays exponentially; spaced review resets the curve each time.\n',
  });
  const jamesClear = makeWikiPage('wiki/entities/james-clear.md', {
    title: 'James Clear',
    summary: 'Author of Atomic Habits; coined "habit stacking".',
    sources: ['raw/2026/2026-10-01-atomic-habits/'],
    links: ['wiki/sources/atomic-habits.md'],
    body: '## Early life\n\nWrote [Atomic Habits](../sources/atomic-habits.md).\n',
  });
  const atomicHabits = makeWikiPage('wiki/sources/atomic-habits.md', {
    title: 'Atomic Habits',
    summary: "Clear's system for small, compounding behaviour change.",
    sources: ['raw/2026/2026-10-01-atomic-habits/'],
    links: ['wiki/concepts/habit-stacking.md', 'wiki/entities/james-clear.md'],
    body: 'Argues for [habit stacking](../concepts/habit-stacking.md) by [Clear](../entities/james-clear.md).\n',
  });
  const brainRules = makeWikiPage('wiki/sources/brain-rules.md', {
    title: 'Brain Rules',
    summary: "Medina's twelve principles for how the brain actually works.",
    sources: ['raw/2026/2026-10-02-brain-rules/'],
    links: ['wiki/concepts/forgetting-curve.md'],
    body: 'Medina argues that forgetting is the brain pruning what it was never asked to retrieve, so repetition matters more than intensity. See the [forgetting curve](../concepts/forgetting-curve.md).\n',
  });
  const question = makeWikiPage('wiki/questions/how-long-to-form-a-habit.md', {
    title: 'How long does a habit take to form?',
    summary: 'Sixty-six days at the median, with a huge spread.',
    sources: ['raw/2026/2026-10-01-atomic-habits/'],
    links: ['wiki/concepts/habit-stacking.md'],
    body: 'Lally et al. found a median of 66 days. [Stacking](../concepts/habit-stacking.md) shortens it.\n',
  });

  return {
    pages: [
      habitStacking,
      habitLoop,
      forgettingCurve,
      jamesClear,
      atomicHabits,
      brainRules,
      question,
    ],
    sync: makeWikiSync(),
  };
}
