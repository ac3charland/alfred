import type { Json } from '@/lib/database.types';
import type {
  ReaderCandidate,
  ReaderHealth,
  ReaderHealthSnapshot,
  ReaderOverview,
  ReaderPost,
  ReaderPublication,
  ReaderPublicationListItem,
} from '@/lib/types';

/**
 * Seed builders for the Reader module's two tables — one home, shared by the unit tests, the
 * stories and the Playwright suite (which re-exports them from `e2e/support/constants`), mirroring
 * `lib/comms/fixtures.ts`. Every default is either the migration's own column default or a
 * plausible, deliberately-stated value — a fixture and a real row differ only where the test says
 * so.
 *
 * Deliberately free of any jest/Playwright import: it is imported from Node (the e2e seed
 * builder), the browser (stories) and Jest test files alike.
 */

let sequence = 0;

/** Stable, increasing ISO timestamps so an arrival-ordered list is deterministic. */
function nextTimestamp(): string {
  sequence += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString();
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * An increasing timestamp anchored to NOW rather than to a fixed date, for the columns the app
 * reads against the clock — `received_at` decides whether a post is inside the worklist's 7-day
 * horizon, so a fixture pinned to a calendar date silently ages out as time passes.
 *
 * It shares the sequence with {@link nextTimestamp}, so successive rows still arrive in the order
 * they were built.
 */
function nextRecentTimestamp(): string {
  sequence += 1;
  return new Date(Date.now() - HOUR_MS + sequence * 1000).toISOString();
}

/** Reset the timestamp sequence — call before building a fresh seed. */
export function resetReaderFixtureClock(): void {
  sequence = 0;
}

/** A roster row. Defaults to an auto-discovered, enabled Substack publication. */
export function makeReaderPublication(
  name: string,
  overrides: Partial<ReaderPublication> = {},
): ReaderPublication {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    handle: overrides.handle ?? `${name.toLowerCase().replaceAll(/\s+/g, '')}@substack.com`,
    name,
    domain: overrides.domain ?? null,
    enabled: overrides.enabled ?? true,
    source: overrides.source ?? 'auto',
    notes: overrides.notes ?? null,
    first_seen_at: overrides.first_seen_at ?? nextTimestamp(),
    created_at: overrides.created_at ?? nextTimestamp(),
  };
}

/**
 * A post. Defaults to a fresh, unsummarised row — every state the list renders (done, failed,
 * refused) is stated explicitly via `overrides`, exactly as `makeCommMessage` defaults to unjudged.
 */
export function makeReaderPost(
  publicationId: string,
  // `overview` is typed as the concrete shape it holds rather than the generated `Json | null`,
  // so a caller (readerFixtureSet, a test, a story) can pass `makeReaderOverview(...)` straight
  // through instead of casting at every call site — this function does the one cast the column's
  // generated type still needs.
  overrides: Partial<Omit<ReaderPost, 'overview'>> & { overview?: ReaderOverview | null } = {},
): ReaderPost {
  const receivedAt = overrides.received_at ?? nextRecentTimestamp();
  return {
    id: overrides.id ?? crypto.randomUUID(),
    publication_id: publicationId,
    comm_message_id: overrides.comm_message_id ?? null,
    account_key: overrides.account_key ?? 'gmail-personal',
    gmail_message_id: overrides.gmail_message_id ?? crypto.randomUUID(),
    rfc822_message_id: overrides.rfc822_message_id ?? null,
    title: overrides.title ?? 'Untitled post',
    author: overrides.author ?? null,
    canonical_url: overrides.canonical_url ?? null,
    received_at: receivedAt,
    text: overrides.text ?? null,
    word_count: overrides.word_count ?? 0,
    html_extracted: overrides.html_extracted ?? false,
    headline: overrides.headline ?? null,
    gist: overrides.gist ?? null,
    overview: (overrides.overview as Json | null | undefined) ?? null,
    model: overrides.model ?? null,
    prompt_version: overrides.prompt_version ?? null,
    summary_state: overrides.summary_state ?? 'pending',
    summarize_attempts: overrides.summarize_attempts ?? 0,
    last_error: overrides.last_error ?? null,
    summarizing_since: overrides.summarizing_since ?? null,
    model_called_at: overrides.model_called_at ?? null,
    summarized_at: overrides.summarized_at ?? null,
    opened_at: overrides.opened_at ?? null,
    archived_at: overrides.archived_at ?? null,
    text_swept_at: overrides.text_swept_at ?? null,
    created_at: overrides.created_at ?? receivedAt,
  };
}

/**
 * A roster row as the publications surface reads it — the table row plus the newest post's
 * arrival, which is derived by the view rather than stored. Defaults to a publication that has
 * not had a post yet.
 */
export function makeReaderPublicationListItem(
  name: string,
  overrides: Partial<ReaderPublicationListItem> = {},
): ReaderPublicationListItem {
  return {
    ...makeReaderPublication(name, overrides),
    last_post_at: overrides.last_post_at ?? null,
  };
}

/** An off-roster bulk sender, as the candidates view ranks them. */
export function makeReaderCandidate(
  handle: string,
  overrides: Partial<ReaderCandidate> = {},
): ReaderCandidate {
  return {
    handle,
    name: overrides.name ?? null,
    message_count: overrides.message_count ?? 1,
    last_seen_at: overrides.last_seen_at ?? nextRecentTimestamp(),
  };
}

/**
 * The instant `makeReaderHealth` shapes its presets around when the caller names none — fixed,
 * so a snapshot test of a health surface does not drift with the wall clock.
 */
export const READER_HEALTH_FIXTURE_NOW = '2026-09-18T12:00:00.000Z';

/**
 * The snapshot before anything has been read or has ever run: no health row, no account. What
 * the shell hands the provider when both reads come back empty, and what a surface that is not
 * about health seeds itself with.
 */
export const NO_READER_HEALTH: ReaderHealthSnapshot = { health: undefined, account: undefined };

/**
 * The states the health row can be in, as the surfaces that read it name them. `never` is the
 * row as the migration seeds it — row 1 with every other column still null — which is what "the
 * tick has never run" looks like in a live database; {@link NO_READER_HEALTH} covers the older
 * shape of the same state, a database with no row at all.
 */
export type ReaderHealthPreset = 'live' | 'stalled' | 'ceiling' | 'error' | 'never';

const MINUTE_MS = 60 * 1000;

/**
 * An override the caller actually stated, or the preset's own value. Distinguishes `null` (a
 * chosen value — every health column is nullable) from `undefined` (not overridden at all),
 * which `??` cannot.
 */
function stated<T>(override: T | undefined, fallback: T): T {
  // A statement, not a ternary: `??` would collapse a deliberate `null` into the fallback, and a
  // conditional EXPRESSION here reads to the linter as exactly that `??`.
  if (override === undefined) return fallback;
  return override;
}

/**
 * The singleton health row in one of its states, shaped relative to `now` — a row read against
 * the clock ("stalled since…", "the cap is spent for today") only means anything relative to an
 * instant, so the same instant the caller renders with is the one it is built from.
 *
 * `stalled` and `error` are the same row: the summariser being stalled IS the tick having
 * recorded a systemic failure more recently than a success. Both names are kept because the two
 * surfaces that read it call the state different things.
 */
export function makeReaderHealth(
  preset: ReaderHealthPreset,
  overrides: Partial<ReaderHealth> = {},
  now: Date = new Date(READER_HEALTH_FIXTURE_NOW),
): ReaderHealth {
  const recently = new Date(now.getTime() - MINUTE_MS).toISOString();
  const today = now.toISOString().slice(0, 10);
  const errored = preset === 'stalled' || preset === 'error';
  // The seeded row: the migration writes row 1 and nothing else, and the tick fills it in from
  // `last_run_at` outwards, so every other column is still null until it first fires.
  const seeded = preset === 'never';
  const succeeded = errored ? new Date(now.getTime() - 120 * MINUTE_MS).toISOString() : recently;
  const spent = preset === 'ceiling' ? 30 : 3;

  // Each column reads through `stated`, not `??`, so an override of `null` is a value the caller
  // CHOSE rather than an absent one: every column here is genuinely nullable — "the tick has
  // never succeeded", "no cap has been stamped" — and a builder that could not express them
  // would make each such test spread over its own result to get there.
  return {
    id: stated(overrides.id, 1),
    last_run_at: stated(overrides.last_run_at, seeded ? null : recently),
    last_success_at: stated(overrides.last_success_at, seeded ? null : succeeded),
    last_error: stated(overrides.last_error, errored ? 'ANTHROPIC_API_KEY is not set' : null),
    last_error_at: stated(overrides.last_error_at, errored ? recently : null),
    daily_cap: stated(overrides.daily_cap, seeded ? null : 30),
    calls_today: stated(overrides.calls_today, seeded ? null : spent),
    calls_day: stated(overrides.calls_day, seeded ? null : today),
  };
}

/** A `done` post's structured take. Defaults to the Import AI mockup's four sections. */
export function makeReaderOverview(overrides: Partial<ReaderOverview> = {}): ReaderOverview {
  return {
    novel_ideas: overrides.novel_ideas ?? [
      'Dexterity evals show a 30–40 point sim-to-real gap that scaling the simulator does not close.',
    ],
    evidence: overrides.evidence ?? [
      'Three eval releases with links; the robotics one includes raw per-task numbers.',
      'An internal replication the author ran, n=1, flagged as such.',
    ],
    argument:
      overrides.argument ??
      "The issue opens with the week's benchmark releases, notes that two of the three are " +
        're-releases with new baselines, and spends its length on the robotics result: a folding ' +
        'task where policies that reach 95% in simulation land at 55–60% on hardware.',
    who_should_read:
      overrides.who_should_read ??
      'Anyone tracking robotics benchmarks. Everyone else has the gist.',
  };
}

/**
 * One publication and one post per state the reading list renders: done with a canonical URL,
 * done with no canonical URL but an rfc822 id (the mailbox-permalink fallback), pending, failed,
 * refused, and done with neither a URL nor an rfc822 id (Open has nothing to point at). Titles and
 * gists are drawn from the spec's mockup where it names one; the sixth state has no mockup row, so
 * its title is original.
 */
export function readerFixtureSet(): { publication: ReaderPublication; posts: ReaderPost[] } {
  const publication = makeReaderPublication('Second Thoughts');

  const doneWithLink = makeReaderPost(publication.id, {
    title: 'How near is the intelligence explosion, really?',
    author: 'Second Thoughts',
    canonical_url: 'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
    rfc822_message_id: '<intelligence-explosion.2026-09-16@mail.substack.com>',
    word_count: 3220,
    html_extracted: true,
    summary_state: 'done',
    headline: 'The recursive-self-improvement debate is three debates wearing one name.',
    gist:
      'Argues the "recursive self-improvement" debate conflates three different feedback loops ' +
      'and that only one of them (automated ML research) has any evidence behind it. A genuinely ' +
      'new framing — worth reading if you follow the RSI argument; skip if you only want the ' +
      'conclusion.',
    overview: makeReaderOverview({
      novel_ideas: [
        'Splits "recursive self-improvement" into three distinct loops — architecture search, ' +
          'training-process tooling, and automated ML research — and argues only the third has ' +
          'any empirical evidence behind it.',
      ],
      evidence: [
        'Surveys five published automated-research pipelines and what fraction of their output ' +
          'shipped in a real training run.',
      ],
      argument:
        'Most "the singularity is near" arguments point at the loop with no evidence and borrow ' +
        'urgency from the loop that has some — the piece untangles which claims survive that swap.',
      who_should_read: 'Anyone who already has a view on RSI timelines and wants it stress-tested.',
    }),
    model: 'claude-sonnet-5',
    prompt_version: 1,
    model_called_at: nextTimestamp(),
    summarized_at: nextTimestamp(),
  });

  const doneMailboxFallback = makeReaderPost(publication.id, {
    title: 'Import AI 412: three new evals, and a robot that folds',
    author: 'Import AI',
    canonical_url: null,
    rfc822_message_id: '<import-ai-412@mail.substack.com>',
    word_count: 1840,
    html_extracted: true,
    summary_state: 'done',
    headline: 'Most of this issue is a rerun; the robotics number is the real story.',
    gist:
      "Roundup issue. Most of it restates last week's benchmark releases; the one new item is a " +
      'robotics dexterity eval with a surprising sim-to-real gap. Not worth reading in full unless ' +
      'you track robotics evals.',
    overview: makeReaderOverview(),
    model: 'claude-sonnet-5',
    prompt_version: 1,
    model_called_at: nextTimestamp(),
    summarized_at: nextTimestamp(),
  });

  const pending = makeReaderPost(publication.id, {
    title: 'The AI capex question',
    author: 'Stratechery',
    canonical_url: 'https://stratechery.com/2026/the-ai-capex-question/',
    rfc822_message_id: '<ai-capex-question@stratechery.com>',
    word_count: 2640,
    html_extracted: true,
    summary_state: 'pending',
  });

  const failed = makeReaderPost(publication.id, {
    title: 'Open Thread 348',
    author: 'Astral Codex Ten',
    canonical_url: 'https://astralcodexten.substack.com/p/open-thread-348',
    rfc822_message_id: '<open-thread-348@mail.substack.com>',
    word_count: 6500,
    html_extracted: true,
    summary_state: 'failed',
    summarize_attempts: 3,
    last_error: "the model's output didn't fit the schema three times",
  });

  const refused = makeReaderPost(publication.id, {
    title: 'A post the model declined',
    author: 'Some Substack',
    canonical_url: 'https://somesubstack.substack.com/p/a-post-the-model-declined',
    rfc822_message_id: '<a-post-the-model-declined@mail.substack.com>',
    word_count: 420,
    html_extracted: true,
    summary_state: 'refused',
    model: 'claude-sonnet-5',
    prompt_version: 1,
    model_called_at: nextTimestamp(),
  });

  const doneNoLink = makeReaderPost(publication.id, {
    title: "The best arguments are the ones you can't dismiss quickly",
    author: 'Second Thoughts',
    canonical_url: null,
    rfc822_message_id: null,
    word_count: 980,
    html_extracted: false,
    summary_state: 'done',
    headline: 'Steelmanning is a discipline, not a courtesy.',
    gist:
      'A short piece distinguishing arguments you disagree with from ones you cannot immediately ' +
      'locate the flaw in, and arguing only the second kind are worth real time. A plain-text ' +
      'mailing with no post link and no retrievable message id, so the row has nowhere for Open ' +
      'to point.',
    overview: makeReaderOverview({
      novel_ideas: [
        'Proposes a one-question test for whether an argument deserves a rebuttal: can you name ' +
          'the specific premise you doubt, not just the conclusion.',
      ],
      evidence: ["A handful of worked examples from the author's own reading list."],
      argument:
        'Most disagreement is with a conclusion, not a premise, and the piece argues that only ' +
        'premise-level disagreement is worth writing up.',
      who_should_read: 'Anyone who debates online more than they read the other side.',
    }),
    model: 'claude-sonnet-5',
    prompt_version: 1,
    model_called_at: nextTimestamp(),
    summarized_at: nextTimestamp(),
  });

  return {
    publication,
    posts: [doneWithLink, doneMailboxFallback, pending, failed, refused, doneNoLink],
  };
}
