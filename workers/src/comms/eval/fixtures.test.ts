import { buildCommsRequest, resolveSender } from '../prompt';
import {
  type CommFixture,
  FIXTURES,
  FIXTURE_ACCOUNTS,
  FIXTURE_NOW,
  FIXTURE_PEOPLE,
  FIXTURE_RUBRIC,
  FIXTURE_TIME_ZONE,
} from './fixtures';

/** The request one fixture produces, rubric and roster included — the prompt the eval sends. */
function build(fixture: CommFixture): { system: string; user: string } {
  return buildCommsRequest({
    message: fixture.message,
    account: fixture.account,
    rubric: FIXTURE_RUBRIC,
    examples: [],
    people: FIXTURE_PEOPLE,
    timeZone: FIXTURE_TIME_ZONE,
    now: FIXTURE_NOW,
    thread: fixture.thread,
  });
}

/** One fixture by id, or a throw — a renamed fixture should fail loudly, not silently pass. */
function byId(id: string): CommFixture {
  const found = FIXTURES.find((fixture) => fixture.id === id);
  if (found === undefined) throw new Error(`no fixture named ${id}`);
  return found;
}

/** What the roster says about a fixture's sender, or `undefined` when nobody claims the handle. */
function priorityOf(fixture: CommFixture): string | undefined {
  return resolveSender(fixture.message.sender_handle, FIXTURE_PEOPLE)?.priority;
}

describe('the evaluation set', () => {
  it('is large enough to say something about recall', () => {
    // Small enough to hand-write and hand-check, large enough that one wrong answer moves a
    // number by a couple of points rather than by a fifth.
    expect(FIXTURES.length).toBeGreaterThanOrEqual(40);
  });

  it('carries both sides of the boundary it measures', () => {
    const queued = FIXTURES.filter((fixture) => fixture.expected.queued);

    // A set of nothing but obligations would score a perfect recall on a classifier that queued
    // literally everything, which is the one failure mode this set exists to catch.
    expect(queued.length).toBeGreaterThanOrEqual(15);
    expect(FIXTURES.length - queued.length).toBeGreaterThanOrEqual(15);
  });

  it('covers all four tiers', () => {
    const tiers = new Set(FIXTURES.map((fixture) => fixture.expected.tier));

    expect(tiers).toEqual(new Set(['asap', 'today', 'whenever', 'fyi']));
  });

  it('gives asap enough fixtures that one flipped case does not swing the precision number 20 points', () => {
    // asap started at n=5 (one case worth ±20 points) despite being the tier the whole
    // recall-bias design is balanced against — an unearned asap spends the tier's credibility.
    // n=10 halves that swing; still small, but the eval report's Wilson interval is what carries
    // the rest of the honesty.
    const asapFixtures = FIXTURES.filter((fixture) => fixture.expected.tier === 'asap');

    expect(asapFixtures.length).toBeGreaterThanOrEqual(10);
  });

  it('keeps queued and the tier in step, so recall cannot be scored against itself', () => {
    for (const fixture of FIXTURES) {
      expect(fixture.expected.queued).toBe(fixture.expected.tier !== 'fyi');
    }
  });

  it('gives every fixture a distinct id', () => {
    expect(new Set(FIXTURES.map((fixture) => fixture.id)).size).toBe(FIXTURES.length);
  });

  it('names a real fixture account on every message', () => {
    const ids = new Set(FIXTURE_ACCOUNTS.map((account) => account.id));

    for (const fixture of FIXTURES) {
      expect(ids.has(fixture.message.account_id)).toBe(true);
      expect(fixture.message.account_id).toBe(fixture.account.id);
    }
  });

  it('holds the text-less cases the degradation rules turn on', () => {
    const textless = FIXTURES.filter((fixture) => fixture.message.body === '');

    // A photo from someone who matters and a photo from nobody must both be in the set: they are
    // one rule, and the roster is the only thing that separates them.
    expect(textless.length).toBeGreaterThanOrEqual(2);
    expect(textless.every((fixture) => fixture.message.has_attachments)).toBe(true);
    expect(new Set(textless.map((fixture) => fixture.expected.tier)).size).toBeGreaterThan(1);
  });

  it('builds a request for every fixture without any I/O', () => {
    for (const fixture of FIXTURES) {
      const request = build(fixture);

      expect(request.user).toContain(`Account: ${fixture.account.label}`);
      expect(request.system).toContain(FIXTURE_RUBRIC.body);
    }
  });

  /**
   * The two sender pairs, and what makes them an instrument rather than two more opinions: each
   * holds the message text fixed and varies ONLY the roster priority of who sent it. If a pair
   * comes back with the same tier twice, the acknowledgement floor is not firing at all — and
   * the first thing to check is handle resolution, because an unresolved handle makes a priority
   * person read as a stranger and the rule can never fire.
   */
  const PAIRS = [
    ['text-arrival-priority', 'text-arrival-other'],
    ['text-news-priority', 'text-news-shared'],
  ] as const;

  it.each(PAIRS)('holds the message fixed across the %s / %s pair', (high, other) => {
    const one = byId(high);
    const two = byId(other);

    expect(one.message.body).toBe(two.message.body);
    expect(one.account.id).toBe(two.account.id);
    // The whole difference is who sent it, and what the roster says about them.
    expect(one.message.sender_handle).not.toBe(two.message.sender_handle);
    expect(priorityOf(one)).toBe('high');
    expect(priorityOf(two)).not.toBe('high');
    expect(one.expected.tier).toBe('today');
    expect(two.expected.tier).toBe('whenever');
  });

  it('resolves every rostered fixture sender, so a pair can never be measuring a stranger', () => {
    for (const [high] of PAIRS) {
      expect(priorityOf(byId(high))).toBeDefined();
    }
  });

  it('guards the closers from a priority sender, where a miss is loudest', () => {
    const guards = [
      'text-reaction-priority',
      'text-emoji-only-priority',
      'text-ack-closer-priority',
      'text-answer-closes-loop-priority',
    ];

    for (const id of guards) {
      const fixture = byId(id);
      expect(priorityOf(fixture)).toBe('high');
      expect(fixture.expected.tier).toBe('fyi');
    }
  });

  it('renders a transcript for every fixture that carries a thread, and none for the rest', () => {
    const threaded = FIXTURES.filter((fixture) => (fixture.thread ?? []).length > 0);
    expect(threaded.length).toBeGreaterThanOrEqual(4);

    for (const fixture of FIXTURES) {
      const { user } = build(fixture);
      expect(user.includes('<<<THREAD>>>')).toBe((fixture.thread ?? []).length > 0);
    }
  });

  it('dates every thread entry before the message it precedes', () => {
    for (const fixture of FIXTURES) {
      for (const entry of fixture.thread ?? []) {
        expect(new Date(entry.received_at).getTime()).toBeLessThan(
          new Date(fixture.message.received_at).getTime(),
        );
      }
    }
  });
});
