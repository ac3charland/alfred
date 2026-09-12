/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import type { GithubRepoConfig } from './config';
import { HISTORY_WEEKS, ROLLING_AVERAGE_WEEKS, fetchLocVelocity, weekStartSeconds } from './loc';

// Neutralise `import 'server-only'`, which has no Jest-visible implementation.
jest.mock('server-only', () => ({}));

const SECONDS_PER_WEEK = 604_800;

/** Saturday 12 Sep 2026 — mid-week, so the newest bucket is a partial one. */
const NOW = new Date('2026-09-12T18:00:00Z');

/** The Sunday that opens the week containing {@link NOW}: 6 Sep 2026. */
const CURRENT_WEEK = weekStartSeconds(NOW);

const CONFIG: GithubRepoConfig = {
  repos: [{ owner: 'ac3charland', name: 'alfred', label: 'Alfred' }],
  authors: ['ac3charland'],
  token: 'ghp_test',
};

const TWO_REPOS: GithubRepoConfig = {
  ...CONFIG,
  repos: [...CONFIG.repos, { owner: 'ac3charland', name: 'realplay', label: 'RealPlay' }],
};

/** The week-start timestamp `weeksAgo` weeks before the current one. */
function weekAgo(weeksAgo: number): number {
  return CURRENT_WEEK - weeksAgo * SECONDS_PER_WEEK;
}

interface ContributorFixture {
  author: { login: string } | null;
  weeks: { w: number; a: number; d: number; c: number }[];
}

/** Stub the per-repo statistics fan-out: one queued response per repo, in configured order. */
function mockGithub(responses: { status: number; body?: unknown }[]): void {
  let call = 0;
  globalThis.fetch = (() => {
    const response = responses[call] ?? responses.at(-1);
    call += 1;
    return Promise.resolve({
      ok: (response?.status ?? 200) < 400,
      status: response?.status ?? 200,
      json: () => Promise.resolve(response?.body ?? []),
    });
  }) as unknown as typeof fetch;
}

/** One repo answering 200 with these contributor rows. */
function mockContributors(...contributors: ContributorFixture[]): void {
  mockGithub([{ status: 200, body: contributors }]);
}

/** The velocity payload, or a thrown assertion if the fan-out didn't come back ready. */
async function velocity(config: GithubRepoConfig = CONFIG) {
  const outcome = await fetchLocVelocity(config, NOW);
  if (outcome.status !== 'ready') throw new Error(`expected ready, got ${outcome.status}`);
  return outcome.velocity;
}

/** Just the drawn weeks — the shape most cases assert on. */
async function weeksOf(config: GithubRepoConfig = CONFIG) {
  const payload = await velocity(config);
  return payload.weeks;
}

/** The most recent COMPLETE week: the one before the week still in progress. */
async function lastCompleteWeek(config: GithubRepoConfig = CONFIG) {
  const weeks = await weeksOf(config);
  return weeks.at(-2);
}

describe('weekStartSeconds', () => {
  it('anchors on the Sunday 00:00 UTC opening the week, whatever the time of day', () => {
    // 6 Sep 2026 is a Sunday; 12 Sep is the Saturday closing the same week.
    expect(weekStartSeconds(new Date('2026-09-12T23:59:59Z'))).toBe(
      Date.parse('2026-09-06T00:00:00Z') / 1000,
    );
    expect(weekStartSeconds(new Date('2026-09-06T00:00:00Z'))).toBe(
      Date.parse('2026-09-06T00:00:00Z') / 1000,
    );
  });

  it('rolls to the previous Sunday the instant a week closes', () => {
    expect(weekStartSeconds(new Date('2026-09-05T23:59:59Z'))).toBe(
      Date.parse('2026-08-30T00:00:00Z') / 1000,
    );
  });
});

describe('fetchLocVelocity', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('adds deletions to the churn rather than subtracting them', async () => {
    mockContributors({
      author: { login: 'ac3charland' },
      weeks: [{ w: weekAgo(1), a: 300, d: 120, c: 4 }],
    });

    const week = await lastCompleteWeek();

    // `stats/contributors` reports deletions POSITIVE, unlike `stats/code_frequency`. Churn is
    // additions PLUS deletions: 420, never 180.
    expect(week?.lines).toBe(420);
  });

  it('counts only the allowlisted logins, case-insensitively', async () => {
    mockContributors(
      { author: { login: 'AC3Charland' }, weeks: [{ w: weekAgo(1), a: 100, d: 0, c: 1 }] },
      { author: { login: 'someone-else' }, weeks: [{ w: weekAgo(1), a: 999, d: 0, c: 1 }] },
    );

    const week = await lastCompleteWeek();

    expect(week?.lines).toBe(100);
  });

  it('drops unattributable commits under an allowlist — they cannot match it', async () => {
    mockContributors({ author: null, weeks: [{ w: weekAgo(1), a: 500, d: 0, c: 1 }] });

    const week = await lastCompleteWeek();

    expect(week?.lines).toBe(0);
  });

  it('counts unattributable commits when no allowlist is configured', async () => {
    mockContributors({ author: null, weeks: [{ w: weekAgo(1), a: 500, d: 0, c: 1 }] });

    const { weeks } = await velocity({ ...CONFIG, authors: [] });

    expect(weeks.at(-2)?.lines).toBe(500);
  });

  it('excludes the dependency bots by name when no allowlist is configured', async () => {
    mockContributors(
      { author: { login: 'dependabot[bot]' }, weeks: [{ w: weekAgo(1), a: 9000, d: 0, c: 1 }] },
      { author: { login: 'renovate[bot]' }, weeks: [{ w: weekAgo(1), a: 9000, d: 0, c: 1 }] },
      { author: { login: 'github-actions[bot]' }, weeks: [{ w: weekAgo(1), a: 9000, d: 0, c: 1 }] },
      { author: { login: 'ac3charland' }, weeks: [{ w: weekAgo(1), a: 40, d: 0, c: 1 }] },
    );

    const week = await lastCompleteWeek({ ...CONFIG, authors: [] });

    expect(week?.lines).toBe(40);
  });

  it('sums the same week across every configured repo', async () => {
    mockGithub([
      {
        status: 200,
        body: [{ author: { login: 'ac3charland' }, weeks: [{ w: weekAgo(1), a: 10, d: 5, c: 1 }] }],
      },
      {
        status: 200,
        body: [{ author: { login: 'ac3charland' }, weeks: [{ w: weekAgo(1), a: 20, d: 0, c: 1 }] }],
      },
    ]);

    const week = await lastCompleteWeek(TWO_REPOS);

    expect(week?.lines).toBe(35);
  });

  it('zero-fills the weeks a repo reports nothing for, including before it existed', async () => {
    // A repo three weeks old: the only bucket it carries is the most recent complete week.
    mockContributors({
      author: { login: 'ac3charland' },
      weeks: [{ w: weekAgo(1), a: 60, d: 0, c: 2 }],
    });

    const { weeks } = await velocity();

    expect(weeks).toHaveLength(HISTORY_WEEKS);
    expect(weeks.slice(0, -2).every((week) => week.lines === 0)).toBe(true);
  });

  it('returns exactly the drawn window, oldest first, keyed by each week’s Sunday', async () => {
    mockContributors();

    const { weeks } = await velocity();

    expect(weeks).toHaveLength(HISTORY_WEEKS);
    expect(weeks[0]?.week).toBe('2026-06-21');
    expect(weeks.at(-1)?.week).toBe('2026-09-06');
  });

  it('gives the first drawn week a TRUE trailing mean, from history read before it', async () => {
    // The three weeks before the window open, which are read but never drawn.
    mockContributors({
      author: { login: 'ac3charland' },
      weeks: [
        { w: weekAgo(HISTORY_WEEKS + 2), a: 100, d: 0, c: 1 },
        { w: weekAgo(HISTORY_WEEKS + 1), a: 200, d: 0, c: 1 },
        { w: weekAgo(HISTORY_WEEKS), a: 300, d: 0, c: 1 },
        { w: weekAgo(HISTORY_WEEKS - 1), a: 400, d: 0, c: 1 },
      ],
    });

    const { weeks } = await velocity();

    // Mean of 100/200/300/400 — not 400, which is what a window starting at the first drawn
    // bar would have produced.
    expect(weeks[0]?.average).toBe(250);
  });

  it('flags the week in progress and withholds its average so the trend line stops', async () => {
    mockContributors({
      author: { login: 'ac3charland' },
      weeks: [{ w: CURRENT_WEEK, a: 1000, d: 980, c: 5 }],
    });

    const weeks = await weeksOf();
    const current = weeks.at(-1);

    expect(current).toMatchObject({
      week: '2026-09-06',
      lines: 1980,
      partial: true,
      average: null,
    });
  });

  it('marks every other week complete, with a rounded trailing mean', async () => {
    mockContributors({
      author: { login: 'ac3charland' },
      weeks: [{ w: weekAgo(1), a: 101, d: 0, c: 1 }],
    });

    const previous = await lastCompleteWeek();

    expect(previous?.partial).toBe(false);
    // 101 spread over the four-week window, rounded.
    expect(previous?.average).toBe(25);
  });

  it('reports the window the averages were taken over, and the repos and authors counted', async () => {
    mockContributors();

    const payload = await velocity(TWO_REPOS);

    expect(payload).toMatchObject({
      averageWeeks: ROLLING_AVERAGE_WEEKS,
      repos: ['ac3charland/alfred', 'ac3charland/realplay'],
      authors: ['ac3charland'],
    });
  });

  it('sinks the whole response when any repo fails — a partial count is a wrong count', async () => {
    mockGithub([{ status: 200, body: [] }, { status: 503 }]);

    await expect(fetchLocVelocity(TWO_REPOS, NOW)).resolves.toStrictEqual({ status: 'failed' });
  });

  it('reports "computing" when any repo is still being aggregated', async () => {
    mockGithub([{ status: 200, body: [] }, { status: 202 }]);

    await expect(fetchLocVelocity(TWO_REPOS, NOW)).resolves.toStrictEqual({ status: 'computing' });
  });

  it('prefers a failure over a pending aggregation — one is recoverable by waiting, one is not', async () => {
    mockGithub([{ status: 202 }, { status: 503 }]);

    await expect(fetchLocVelocity(TWO_REPOS, NOW)).resolves.toStrictEqual({ status: 'failed' });
  });

  it('treats a network failure as no trustworthy count', async () => {
    globalThis.fetch = () => Promise.reject(new Error('offline'));

    await expect(fetchLocVelocity(CONFIG, NOW)).resolves.toStrictEqual({ status: 'failed' });
  });

  it('never sends the token anywhere but the Authorization header', async () => {
    const urls: string[] = [];
    globalThis.fetch = ((input: string) => {
      urls.push(input);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    }) as unknown as typeof fetch;

    await fetchLocVelocity(CONFIG, NOW);

    expect(urls).toStrictEqual([
      'https://api.github.com/repos/ac3charland/alfred/stats/contributors',
    ]);
  });
});
