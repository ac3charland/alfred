import type { WikiPageIndexRow, WikiPageRow, WikiSync } from '@/lib/types';
import { type WikiSection, splitWikiPath, wikiPagePath } from '@/lib/wiki/sections';

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

/**
 * The landing web's sample: 38 concepts and 14 entities linked 67 ways (undirected), in clusters
 * a reader would recognise — learning and memory, habits, relationships, longevity, knowledge
 * work — plus three sources and two questions, so a search spans every section and a test can
 * show that neither list appears on the landing.
 *
 * Every concept's `created` falls in the fortnight before the stories' clock (2026-10-03), and
 * the dates are chosen so that day's concept of the day is "Desirable difficulty".
 * Each row is `[stem, title, created, summary?, tags?]`.
 */
const WEB_CONCEPTS: readonly (readonly [string, string, string, string?, string[]?])[] = [
  [
    'desirable-difficulty',
    'Desirable difficulty',
    '2026-10-02',
    'Conditions that make learning feel slower (spacing, interleaving, testing yourself) are the ones that make it last.',
    ['learning', 'memory'],
  ],
  [
    'spaced-repetition',
    'Spaced repetition',
    '2026-09-19',
    'Reviewing just before you’d forget resets the forgetting curve at a longer interval each time.',
    ['memory'],
  ],
  [
    'retrieval-practice',
    'Retrieval practice',
    '2026-09-19',
    'Pulling an answer out of memory strengthens it more than reading it again.',
    ['memory'],
  ],
  [
    'interleaving',
    'Interleaving',
    '2026-09-20',
    'Mixing problem types in one session.',
    ['learning'],
  ],
  [
    'forgetting-curve',
    'Forgetting curve',
    '2026-09-20',
    'Ebbinghaus’s decay of recall over time.',
    ['memory'],
  ],
  ['deliberate-practice', 'Deliberate practice', '2026-09-21'],
  ['working-memory', 'Working memory', '2026-09-21'],
  ['sleep-consolidation', 'Sleep and memory', '2026-09-22'],
  ['exercise-cognition', 'Exercise and cognition', '2026-09-22'],
  ['stress-learning', 'Stress and learning', '2026-09-23'],
  ['attention-ten-minutes', 'The ten-minute rule', '2026-09-23'],
  ['elaboration', 'Elaboration', '2026-09-24'],
  ['multisensory', 'Multisensory learning', '2026-09-24'],
  ['habit-loop', 'Habit loop', '2026-09-25'],
  ['habit-stacking', 'Habit stacking', '2026-09-25'],
  ['identity-habits', 'Identity-based habits', '2026-09-26'],
  ['implementation-intentions', 'Implementation intentions', '2026-09-26'],
  ['environment-design', 'Environment design', '2026-09-27'],
  ['two-minute-rule', 'Two-minute rule', '2026-09-27'],
  ['tiny-habits', 'Tiny habits', '2026-09-28'],
  ['dopamine-anticipation', 'Dopamine and anticipation', '2026-09-28'],
  ['bids-for-connection', 'Bids for connection', '2026-09-29'],
  ['four-horsemen', 'The four horsemen', '2026-09-29'],
  ['repair-attempts', 'Repair attempts', '2026-09-30'],
  ['chestertons-fence', 'Chesterton’s fence', '2026-09-30'],
  ['democracy-of-the-dead', 'Democracy of the dead', '2026-10-01'],
  ['zone-2', 'Zone 2 training', '2026-10-01'],
  ['vo2-max', 'VO2 max', '2026-09-19'],
  ['medicine-3', 'Medicine 3.0', '2026-09-20'],
  ['centenarian-decathlon', 'Centenarian decathlon', '2026-09-21'],
  ['llm-wiki', 'LLM wiki', '2026-09-22'],
  ['rag-failure', 'Why RAG forgets', '2026-09-23'],
  ['zettelkasten', 'Zettelkasten', '2026-09-24'],
  ['progressive-summarization', 'Progressive summarization', '2026-09-25'],
  ['compounding-knowledge', 'Compounding knowledge', '2026-09-26'],
  ['second-brain', 'Second brain', '2026-09-27'],
  ['flow', 'Flow', '2026-09-28'],
  ['growth-mindset', 'Growth mindset', '2026-09-29'],
];

/** `[stem, title]` for each entity. */
const WEB_ENTITIES: readonly (readonly [string, string])[] = [
  ['robert-bjork', 'Robert Bjork'],
  ['hermann-ebbinghaus', 'Hermann Ebbinghaus'],
  ['anders-ericsson', 'Anders Ericsson'],
  ['john-medina', 'John Medina'],
  ['james-clear', 'James Clear'],
  ['bj-fogg', 'BJ Fogg'],
  ['john-gottman', 'John Gottman'],
  ['bringing-baby-home', 'Bringing Baby Home'],
  ['gk-chesterton', 'G. K. Chesterton'],
  ['peter-attia', 'Peter Attia'],
  ['andrej-karpathy', 'Andrej Karpathy'],
  ['niklas-luhmann', 'Niklas Luhmann'],
  ['tiago-forte', 'Tiago Forte'],
  ['mihaly-csikszentmihalyi', 'Mihaly Csikszentmihalyi'],
];

/** Each stem's outbound links, by stem; the web draws each pair once, whichever page names it. */
const WEB_LINKS: Readonly<Record<string, readonly string[]>> = {
  'desirable-difficulty': [
    'robert-bjork',
    'spaced-repetition',
    'retrieval-practice',
    'interleaving',
    'forgetting-curve',
    'deliberate-practice',
  ],
  'spaced-repetition': [
    'forgetting-curve',
    'retrieval-practice',
    'sleep-consolidation',
    'habit-loop',
    'compounding-knowledge',
  ],
  'forgetting-curve': ['hermann-ebbinghaus'],
  interleaving: ['robert-bjork'],
  'retrieval-practice': ['elaboration'],
  'deliberate-practice': ['anders-ericsson', 'flow', 'growth-mindset'],
  flow: ['mihaly-csikszentmihalyi'],
  'john-medina': [
    'working-memory',
    'sleep-consolidation',
    'exercise-cognition',
    'stress-learning',
    'attention-ten-minutes',
    'multisensory',
  ],
  'working-memory': ['attention-ten-minutes', 'elaboration'],
  multisensory: ['elaboration'],
  'exercise-cognition': ['zone-2'],
  'stress-learning': ['bringing-baby-home'],
  'john-gottman': ['bringing-baby-home', 'bids-for-connection', 'four-horsemen', 'repair-attempts'],
  'repair-attempts': ['four-horsemen'],
  'bids-for-connection': ['bringing-baby-home'],
  'james-clear': [
    'habit-loop',
    'habit-stacking',
    'identity-habits',
    'environment-design',
    'two-minute-rule',
  ],
  'habit-stacking': ['habit-loop', 'implementation-intentions'],
  'tiny-habits': ['bj-fogg', 'habit-stacking', 'two-minute-rule'],
  'dopamine-anticipation': ['habit-loop'],
  'identity-habits': ['growth-mindset'],
  'gk-chesterton': ['chestertons-fence', 'democracy-of-the-dead'],
  'chestertons-fence': ['democracy-of-the-dead'],
  'peter-attia': [
    'zone-2',
    'vo2-max',
    'medicine-3',
    'centenarian-decathlon',
    'sleep-consolidation',
  ],
  'vo2-max': ['zone-2', 'centenarian-decathlon'],
  'llm-wiki': ['andrej-karpathy', 'rag-failure', 'compounding-knowledge', 'second-brain'],
  zettelkasten: ['niklas-luhmann', 'compounding-knowledge'],
  'tiago-forte': ['progressive-summarization', 'second-brain'],
  'second-brain': ['progressive-summarization', 'zettelkasten'],
};

/**
 * The landing's sample wiki: the 52-page web above, plus Brain Rules, Atomic Habits and Outlive
 * as sources and two questions. Sources and questions link into the web, and the web links back
 * to none of them, so a test can show those links are dropped from the drawing.
 */
export function wikiWebFixtureSet(): { pages: WikiPageRow[]; sync: WikiSync } {
  const sectionOf = new Map<string, WikiSection>([
    ...WEB_CONCEPTS.map(([stem]) => [stem, 'concepts'] as const),
    ...WEB_ENTITIES.map(([stem]) => [stem, 'entities'] as const),
  ]);
  const linksOf = (stem: string): string[] =>
    (WEB_LINKS[stem] ?? []).map((target) =>
      wikiPagePath(sectionOf.get(target) ?? 'concepts', target),
    );

  const concepts = WEB_CONCEPTS.map(([stem, title, created, summary = '', tags = []]) =>
    makeWikiPage(wikiPagePath('concepts', stem), {
      title,
      created,
      summary,
      tags,
      links: linksOf(stem),
    }),
  );
  const entities = WEB_ENTITIES.map(([stem, title]) =>
    makeWikiPage(wikiPagePath('entities', stem), {
      title,
      created: '2026-09-19',
      links: linksOf(stem),
    }),
  );
  const brainRules = makeWikiPage('wiki/sources/brain-rules.md', {
    title: 'Brain Rules',
    summary: "Medina's twelve principles for how the brain actually works.",
    links: ['wiki/entities/john-medina.md', 'wiki/concepts/spaced-repetition.md'],
    body: 'Rule 5, repeat to remember: spaced intervals beat massed study for the same hours.\n',
  });
  const atomicHabits = makeWikiPage('wiki/sources/atomic-habits.md', {
    title: 'Atomic Habits',
    summary: "Clear's system for small, compounding behaviour change.",
    links: ['wiki/entities/james-clear.md', 'wiki/concepts/habit-stacking.md'],
  });
  const outlive = makeWikiPage('wiki/sources/outlive.md', {
    title: 'Outlive',
    summary: "Attia's case for medicine that starts before the disease.",
    links: ['wiki/entities/peter-attia.md', 'wiki/concepts/zone-2.md'],
  });
  const habitQuestion = makeWikiPage('wiki/questions/how-long-to-form-a-habit.md', {
    title: 'How long does a habit take to form?',
    summary: 'Sixty-six days at the median, with a huge spread.',
    links: ['wiki/concepts/habit-stacking.md'],
  });
  const sleepQuestion = makeWikiPage('wiki/questions/does-sleep-help-memory.md', {
    title: 'Does sleep help memory?',
    summary: 'Yes — replay during slow-wave sleep consolidates the day.',
    links: ['wiki/concepts/sleep-consolidation.md'],
  });

  return {
    pages: [
      ...concepts,
      ...entities,
      brainRules,
      atomicHabits,
      outlive,
      habitQuestion,
      sleepQuestion,
    ],
    sync: makeWikiSync(),
  };
}
