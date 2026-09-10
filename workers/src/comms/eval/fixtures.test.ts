import { buildCommsRequest } from '../prompt';
import {
  FIXTURES,
  FIXTURE_ACCOUNTS,
  FIXTURE_NOW,
  FIXTURE_PEOPLE,
  FIXTURE_RUBRIC,
  FIXTURE_TIME_ZONE,
} from './fixtures';

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
      const request = buildCommsRequest({
        message: fixture.message,
        account: fixture.account,
        rubric: FIXTURE_RUBRIC,
        examples: [],
        people: FIXTURE_PEOPLE,
        timeZone: FIXTURE_TIME_ZONE,
        now: FIXTURE_NOW,
      });

      expect(request.user).toContain(`Account: ${fixture.account.label}`);
      expect(request.system).toContain(FIXTURE_RUBRIC.body);
    }
  });
});
