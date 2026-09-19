import { makeCommAccount } from '@/lib/comms/fixtures';
import {
  READER_HEALTH_FIXTURE_NOW,
  makeReaderHealth,
  makeReaderPost,
  resetReaderFixtureClock,
} from '@/lib/reader/fixtures';
import type { ReaderHealthSnapshot, ReaderPostListItem } from '@/lib/types';

import {
  READER_STALL_MINUTES,
  RETRYABLE_ATTEMPTS,
  ceilingReached,
  readerBanner,
  summariserStalled,
  waitingPosts,
} from './health';

const NOW = new Date(READER_HEALTH_FIXTURE_NOW);
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

const MINUTE_MS = 60 * 1000;

/** The last tick of the capped day in {@link deadAfterCap} — the moment its cron stopped. */
const LAST_RUN_BEFORE_DEATH = '2026-09-17T23:50:00.000Z';

/** An instant `minutes` before the pinned now, as the columns store it. */
function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

function post(overrides: Partial<Omit<ReaderPostListItem, 'overview'>> = {}): ReaderPostListItem {
  const { text: _text, ...listItem } = makeReaderPost(PUBLICATION_ID, overrides);
  return listItem;
}

/** A claimed post the tick will still try, claimed `minutes` ago. */
function waiting(minutes: number, overrides: Partial<ReaderPostListItem> = {}): ReaderPostListItem {
  return post({
    summary_state: 'pending',
    summarize_attempts: 0,
    word_count: 1200,
    created_at: ago(minutes),
    ...overrides,
  });
}

/** A clean health row: the tick ran a moment ago and has never recorded a failure. */
function liveRow() {
  return makeReaderHealth('live', {}, NOW);
}

/**
 * A row the tick is still stamping but has not passed cleanly inside the stall window — the
 * state where the waiting posts are the only thing left to read the summariser by.
 */
function quietRow() {
  return makeReaderHealth('live', { last_success_at: ago(120) }, NOW);
}

/** A row left by a cron that spent 2026-09-17's budget and then never fired again. */
function deadAfterCap() {
  return makeReaderHealth(
    'ceiling',
    {
      calls_day: '2026-09-17',
      calls_today: 30,
      daily_cap: 30,
      last_run_at: LAST_RUN_BEFORE_DEATH,
      // Its last clean pass is that same final tick: a success cannot postdate the run it was
      // made in, and a row saying otherwise would read as a summariser working after it died.
      last_success_at: LAST_RUN_BEFORE_DEATH,
    },
    NOW,
  );
}

beforeEach(() => {
  resetReaderFixtureClock();
});

describe('ceilingReached', () => {
  it('is false with no health row at all', () => {
    expect(ceilingReached(undefined, NOW)).toBe(false);
  });

  it('is false when the tick has never recorded a cap', () => {
    const health = makeReaderHealth('ceiling', { daily_cap: null }, NOW);
    expect(ceilingReached(health, NOW)).toBe(false);
  });

  it('is false when nothing has ever been counted', () => {
    const health = makeReaderHealth('ceiling', { calls_today: null }, NOW);
    expect(ceilingReached(health, NOW)).toBe(false);
  });

  it('is false when no day has been counted yet', () => {
    const health = makeReaderHealth('ceiling', { calls_day: null }, NOW);
    expect(ceilingReached(health, NOW)).toBe(false);
  });

  it('is false under the cap on the current day', () => {
    const health = makeReaderHealth('live', { daily_cap: 30, calls_today: 29 }, NOW);
    expect(ceilingReached(health, NOW)).toBe(false);
  });

  it('is true at the cap on the current day', () => {
    const health = makeReaderHealth('ceiling', { daily_cap: 30, calls_today: 30 }, NOW);
    expect(ceilingReached(health, NOW)).toBe(true);
  });

  it('is false when the count at the cap belongs to another day the tick has since run in', () => {
    const health = makeReaderHealth(
      'ceiling',
      { calls_day: '2026-09-17', calls_today: 30, daily_cap: 30, last_run_at: ago(2) },
      NOW,
    );
    expect(ceilingReached(health, NOW)).toBe(false);
  });

  it("holds across the UTC rollover until the new day's first tick has run", () => {
    // Yesterday's count is still on the row and nothing has reset it, so the posts waiting are
    // waiting by design rather than because summarising stopped.
    const health = makeReaderHealth(
      'ceiling',
      {
        calls_day: '2026-09-17',
        calls_today: 30,
        daily_cap: 30,
        last_run_at: '2026-09-17T23:50:00.000Z',
      },
      NOW,
    );
    expect(ceilingReached(health, NOW)).toBe(true);
  });

  it('stops holding once the tick has run in the new day', () => {
    const health = makeReaderHealth(
      'ceiling',
      {
        calls_day: '2026-09-17',
        calls_today: 30,
        daily_cap: 30,
        last_run_at: '2026-09-18T00:05:00.000Z',
      },
      NOW,
    );
    expect(ceilingReached(health, NOW)).toBe(false);
  });

  it('holds when the tick has never run at all', () => {
    const health = makeReaderHealth(
      'ceiling',
      { calls_day: '2026-09-17', calls_today: 30, daily_cap: 30, last_run_at: null },
      NOW,
    );
    expect(ceilingReached(health, NOW)).toBe(true);
  });

  it('still holds the morning after a capped day whose cron then died', () => {
    // 08:00 on the day after the cap was spent, with no tick since: the count is yesterday's and
    // nothing has reset it, so the posts waiting are still waiting by design.
    const health = deadAfterCap();
    expect(ceilingReached(health, new Date('2026-09-18T08:00:00.000Z'))).toBe(true);
  });

  it('stops holding the day after that, however dead the cron is', () => {
    // Two days on, "the count is yesterday's" is no longer true of anything — a count that old
    // says nothing about today's budget, and the stall rules own the silence from here.
    const health = deadAfterCap();
    expect(ceilingReached(health, new Date('2026-09-19T08:00:00.000Z'))).toBe(false);
  });
});

describe('waitingPosts', () => {
  it('counts a claimed post the tick will still try', () => {
    const row = waiting(40);
    expect(waitingPosts([row])).toEqual([row]);
  });

  it('skips a post that is no longer pending', () => {
    expect(waitingPosts([waiting(40, { summary_state: 'done' })])).toEqual([]);
  });

  it('skips a post that has spent its retries', () => {
    expect(waitingPosts([waiting(40, { summarize_attempts: RETRYABLE_ATTEMPTS })])).toEqual([]);
  });

  it('skips a post whose text was swept — the tick has nothing left to summarise', () => {
    expect(waitingPosts([waiting(40, { text_swept_at: ago(10) })])).toEqual([]);
  });

  it('skips a post that never had a body', () => {
    expect(waitingPosts([waiting(40, { word_count: 0 })])).toEqual([]);
  });
});

describe('summariserStalled', () => {
  it('is "never" with no health row, even with a post waiting past the cadence', () => {
    expect(summariserStalled(undefined, [waiting(60)], NOW)).toEqual({
      state: 'never',
      since: null,
    });
  });

  it('is "never" when the seeded row is blank — no run, no error, so the cron has not fired', () => {
    expect(summariserStalled(makeReaderHealth('never', {}, NOW), [waiting(60)], NOW)).toEqual({
      state: 'never',
      since: null,
    });
  });

  it('is stalled, not "never", when the tick failed before it could stamp a run', () => {
    // The pre-flight failures — an unparsable cap, a missing credential, the ceiling count — are
    // stamped ahead of the run, so this row is a misconfigured deploy rather than a dead cron.
    const health = makeReaderHealth(
      'preflight',
      { last_error_at: ago(2), last_error: 'ANTHROPIC_API_KEY is not set' },
      NOW,
    );

    expect(health.last_run_at).toBeNull();
    expect(summariserStalled(health, [], NOW)).toEqual({ state: 'stalled', since: ago(2) });
  });

  it('is stalled when the tick recorded a failure more recently than a success', () => {
    const health = makeReaderHealth(
      'live',
      {
        last_success_at: ago(120),
        last_error_at: ago(48),
        last_error: 'ANTHROPIC_API_KEY is not set',
      },
      NOW,
    );

    expect(summariserStalled(health, [], NOW)).toEqual({ state: 'stalled', since: ago(48) });
  });

  it('is live when the last failure is older than the last success', () => {
    const health = makeReaderHealth(
      'live',
      { last_success_at: ago(5), last_error_at: ago(200) },
      NOW,
    );

    expect(summariserStalled(health, [], NOW)).toEqual({ state: 'live', since: null });
  });

  it('is stalled when a claimed post has waited past the cadence and nothing was summarised in it', () => {
    const health = quietRow();
    const claimed = waiting(READER_STALL_MINUTES + 25);

    expect(summariserStalled(health, [claimed], NOW)).toEqual({
      state: 'stalled',
      since: claimed.created_at,
    });
  });

  it('dates that stall from the last summary that did land, not from the claim', () => {
    const health = quietRow();
    const summarised = post({ summary_state: 'done', summarized_at: ago(30) });

    expect(summariserStalled(health, [waiting(90), summarised], NOW)).toEqual({
      state: 'stalled',
      since: ago(30),
    });
  });

  it('is live when a summary landed inside the cadence — the backlog is draining', () => {
    const health = quietRow();
    const summarised = post({ summary_state: 'done', summarized_at: ago(2) });

    expect(summariserStalled(health, [waiting(90), summarised], NOW)).toEqual({
      state: 'live',
      since: null,
    });
  });

  it('is live when the backlog is waiting because the daily ceiling is spent', () => {
    const health = makeReaderHealth('ceiling', { last_success_at: ago(200) }, NOW);

    expect(summariserStalled(health, [waiting(90)], NOW)).toEqual({ state: 'live', since: null });
  });

  it('reads a row that has only ever started — no success, no error — through the waiting post', () => {
    const health = makeReaderHealth('live', { last_run_at: ago(1), last_success_at: null }, NOW);
    const claimed = waiting(60);

    expect(summariserStalled(health, [claimed], NOW)).toEqual({
      state: 'stalled',
      since: claimed.created_at,
    });
  });

  it('takes the earliest of the two signals, so the banner names when summarising stopped', () => {
    const health = makeReaderHealth(
      'live',
      { last_error_at: ago(20), last_error: 'the key was rejected', last_success_at: null },
      NOW,
    );

    expect(summariserStalled(health, [waiting(300)], NOW)).toEqual({
      state: 'stalled',
      since: ago(300),
    });
  });

  it('is stalled when the tick itself has not run inside the window, with nothing queued', () => {
    // The tick stamps a run every five minutes whether or not it finds work, so a run three
    // cadences old is the cron having stopped — an empty queue proves nothing either way.
    const health = makeReaderHealth(
      'live',
      { last_run_at: ago(20), last_success_at: ago(20) },
      NOW,
    );

    expect(summariserStalled(health, [], NOW)).toEqual({ state: 'stalled', since: ago(20) });
  });

  it('is live when the tick ran inside the window and nothing is waiting', () => {
    const health = makeReaderHealth('live', { last_run_at: ago(4), last_success_at: ago(4) }, NOW);

    expect(summariserStalled(health, [], NOW)).toEqual({ state: 'live', since: null });
  });

  it('counts a run stamped exactly at the cutoff as having stopped', () => {
    const health = makeReaderHealth(
      'live',
      { last_run_at: ago(READER_STALL_MINUTES), last_success_at: ago(READER_STALL_MINUTES) },
      NOW,
    );

    expect(summariserStalled(health, [], NOW)).toEqual({
      state: 'stalled',
      since: ago(READER_STALL_MINUTES),
    });
  });

  it('reads a cron that died over a capped day as stalled the morning after', () => {
    // The ceiling silences the waiting posts and nothing else: a capped day's ticks still stamp
    // runs, so a run that stopped with the budget is a dead cron however full yesterday was.
    expect(
      summariserStalled(deadAfterCap(), [waiting(600)], new Date('2026-09-18T08:00:00.000Z')),
    ).toEqual({ state: 'stalled', since: LAST_RUN_BEFORE_DEATH });
  });

  it('ignores a claimed post still inside the cadence', () => {
    const health = quietRow();

    expect(summariserStalled(health, [waiting(READER_STALL_MINUTES - 1)], NOW)).toEqual({
      state: 'live',
      since: null,
    });
  });

  it('is live when the tick passed cleanly inside the window, however old the claim', () => {
    // A re-summarised post is re-queued with the `created_at` it was first claimed under, so an
    // ancient claim says nothing on its own — the tick's own clean pass is what answers it.
    const requeued = waiting(3 * 24 * 60);

    expect(summariserStalled(liveRow(), [requeued], NOW)).toEqual({ state: 'live', since: null });
  });

  it('is stalled when the tick has not passed cleanly inside the window either', () => {
    const health = makeReaderHealth('live', { last_success_at: ago(20) }, NOW);
    const claimed = waiting(20);

    expect(summariserStalled(health, [claimed], NOW)).toEqual({
      state: 'stalled',
      since: claimed.created_at,
    });
  });

  it('counts a post claimed exactly at the cutoff as having waited past it', () => {
    const health = quietRow();
    const claimed = waiting(READER_STALL_MINUTES);

    expect(summariserStalled(health, [claimed], NOW)).toEqual({
      state: 'stalled',
      since: claimed.created_at,
    });
  });

  it('does not take a summary that landed exactly at the cutoff as proof of life', () => {
    const health = quietRow();
    const summarised = post({ summary_state: 'done', summarized_at: ago(READER_STALL_MINUTES) });

    expect(summariserStalled(health, [waiting(90), summarised], NOW)).toEqual({
      state: 'stalled',
      since: ago(READER_STALL_MINUTES),
    });
  });

  it('does not take a clean tick pass at exactly the cutoff as proof of life either', () => {
    const health = makeReaderHealth('live', { last_success_at: ago(READER_STALL_MINUTES) }, NOW);
    const claimed = waiting(90);

    expect(summariserStalled(health, [claimed], NOW)).toEqual({
      state: 'stalled',
      since: claimed.created_at,
    });
  });
});

describe('readerBanner', () => {
  const account = makeCommAccount('Personal', { key: 'gmail-personal' });

  function snapshot(overrides: Partial<ReaderHealthSnapshot> = {}): ReaderHealthSnapshot {
    return { health: makeReaderHealth('live', {}, NOW), account, ...overrides };
  }

  it('says nothing when the mailbox, the summariser and the ceiling are all fine', () => {
    expect(
      readerBanner(snapshot({ account: { ...account, last_seen_at: ago(1) } }), [], NOW),
    ).toBeNull();
  });

  it('puts the dead mailbox first when every state is bad at once', () => {
    const dead = {
      ...account,
      last_seen_at: ago(600),
      last_error_at: ago(120),
      last_error: 'invalid_grant',
    };
    const health = makeReaderHealth(
      'ceiling',
      { last_success_at: ago(200), last_error_at: ago(48), last_error: 'the key was rejected' },
      NOW,
    );

    expect(readerBanner({ health, account: dead }, [waiting(90)], NOW)).toEqual({
      kind: 'gmail',
      state: 'erroring',
      account: dead,
    });
  });

  it('puts the stall ahead of the ceiling', () => {
    const health = makeReaderHealth(
      'ceiling',
      { last_success_at: ago(200), last_error_at: ago(48), last_error: 'the key was rejected' },
      NOW,
    );

    expect(
      readerBanner({ health, account: { ...account, last_seen_at: ago(1) } }, [waiting(90)], NOW),
    ).toEqual({
      kind: 'stalled',
      since: ago(48),
      error: 'the key was rejected',
    });
  });

  it('reports the ceiling with the cap the tick enforced and the posts waiting on it', () => {
    const health = makeReaderHealth('ceiling', { daily_cap: 30, calls_today: 30 }, NOW);

    expect(
      readerBanner(
        { health, account: { ...account, last_seen_at: ago(1) } },
        [waiting(90), waiting(120), post({ summary_state: 'done' })],
        NOW,
      ),
    ).toEqual({ kind: 'ceiling', cap: 30, waiting: 2 });
  });

  it('skips the mailbox check entirely when no account was ever provisioned', () => {
    const health = makeReaderHealth('ceiling', { daily_cap: 30, calls_today: 30 }, NOW);

    expect(readerBanner({ health, account: undefined }, [], NOW)).toEqual({
      kind: 'ceiling',
      cap: 30,
      waiting: 0,
    });
  });

  it('puts the stall ahead of a mailbox that has merely gone quiet', () => {
    const quiet = { ...account, last_seen_at: ago(600) };
    const health = makeReaderHealth(
      'stalled',
      { last_success_at: ago(200), last_error_at: ago(48), last_error: 'the key was rejected' },
      NOW,
    );

    expect(readerBanner({ health, account: quiet }, [], NOW)).toEqual({
      kind: 'stalled',
      since: ago(48),
      error: 'the key was rejected',
    });
  });

  it('puts a refused mailbox ahead of the stall — only one of the two needs a person', () => {
    const dead = { ...account, last_seen_at: ago(600), last_error_at: ago(1), last_error: 'nope' };
    const health = makeReaderHealth('stalled', { last_error_at: ago(48) }, NOW);

    expect(readerBanner({ health, account: dead }, [], NOW)).toEqual({
      kind: 'gmail',
      state: 'erroring',
      account: dead,
    });
  });

  it('puts a quiet mailbox ahead of the ceiling — one is a fault and the other is the design', () => {
    const quiet = { ...account, last_seen_at: ago(600) };
    const health = makeReaderHealth('ceiling', {}, NOW);

    expect(readerBanner({ health, account: quiet }, [waiting(90)], NOW)).toEqual({
      kind: 'gmail',
      state: 'stale',
      account: quiet,
    });
  });

  it('carries the recorded error when the tick failed before it could stamp a run', () => {
    const health = makeReaderHealth(
      'preflight',
      { last_error_at: ago(2), last_error: 'ANTHROPIC_API_KEY is not set' },
      NOW,
    );

    expect(
      readerBanner({ health, account: { ...account, last_seen_at: ago(1) } }, [], NOW),
    ).toEqual({ kind: 'stalled', since: ago(2), error: 'ANTHROPIC_API_KEY is not set' });
  });

  it('says nothing about a summariser that has never run — there is nothing to be stalled from', () => {
    expect(readerBanner({ health: undefined, account: undefined }, [waiting(90)], NOW)).toBeNull();
    expect(
      readerBanner(
        { health: makeReaderHealth('never', {}, NOW), account: undefined },
        [waiting(90)],
        NOW,
      ),
    ).toBeNull();
  });
});
