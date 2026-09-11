import {
  makeCommAccount,
  makeCommHealth,
  makeCommMessage,
  resetCommFixtureClock,
} from './fixtures';
import { accountHealth, classifierStalled } from './health';

const ACCOUNT = '00000000-0000-4000-8000-00000000000a';
const NOW = new Date('2026-03-01T12:00:00.000Z');

/** An ISO timestamp `minutes` before {@link NOW}. */
function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

beforeEach(() => {
  resetCommFixtureClock();
});

describe('accountHealth', () => {
  it('is live while the last successful poll is inside the expected interval', () => {
    const account = makeCommAccount('personal', {
      expected_interval_seconds: 600,
      last_seen_at: minutesAgo(4),
    });
    expect(accountHealth(account, NOW)).toBe('live');
  });

  it('goes stale once the interval has passed with no successful poll', () => {
    const account = makeCommAccount('iMessage', {
      kind: 'imessage',
      expected_interval_seconds: 60,
      last_seen_at: minutesAgo(180),
    });
    expect(accountHealth(account, NOW)).toBe('stale');
  });

  it('is stale — not live — for an account that has never polled', () => {
    expect(accountHealth(makeCommAccount('workmail', { kind: 'imap' }), NOW)).toBe('stale');
  });

  it('is erroring when the last error is newer than the last success: broken, not quiet', () => {
    const account = makeCommAccount('RealPlay', {
      last_seen_at: minutesAgo(40),
      last_error: 'refresh token rejected',
      last_error_at: minutesAgo(2),
    });
    expect(accountHealth(account, NOW)).toBe('erroring');
  });

  it('is erroring when it has only ever failed', () => {
    const account = makeCommAccount('RealPlay', { last_error_at: minutesAgo(2) });
    expect(accountHealth(account, NOW)).toBe('erroring');
  });

  it('ignores an error a later successful poll has already cleared', () => {
    const account = makeCommAccount('personal', {
      expected_interval_seconds: 600,
      last_error: 'rate limited',
      last_error_at: minutesAgo(45),
      last_seen_at: minutesAgo(1),
    });
    expect(accountHealth(account, NOW)).toBe('live');
  });
});

describe('classifierStalled', () => {
  it('is quiet when the sweep is succeeding and nothing is waiting', () => {
    const health = makeCommHealth({ last_success_at: minutesAgo(2), last_run_at: minutesAgo(2) });
    const judged = makeCommMessage(ACCOUNT, { tier: 'today', judged_by: 'model' });

    expect(classifierStalled(health, [judged], NOW)).toEqual({ stalled: false, since: null });
  });

  it('is quiet with no health row at all — nothing has claimed a failure', () => {
    expect(classifierStalled(undefined, [], NOW)).toEqual({ stalled: false, since: null });
  });

  it('stalls when the sweep recorded a failure newer than its last success', () => {
    const health = makeCommHealth({
      last_success_at: minutesAgo(90),
      last_error: 'missing binding',
      last_error_at: minutesAgo(20),
    });

    expect(classifierStalled(health, [], NOW)).toEqual({
      stalled: true,
      since: minutesAgo(20),
    });
  });

  it('stalls on an inbound message left unjudged past the sweep cadence', () => {
    const waiting = makeCommMessage(ACCOUNT, { received_at: minutesAgo(40) });
    const health = makeCommHealth({ last_success_at: minutesAgo(1) });

    expect(classifierStalled(health, [waiting], NOW)).toEqual({
      stalled: true,
      since: minutesAgo(40),
    });
  });

  it('does not stall on a message the next sweep will still pick up', () => {
    const waiting = makeCommMessage(ACCOUNT, { received_at: minutesAgo(3) });
    expect(classifierStalled(makeCommHealth(), [waiting], NOW).stalled).toBe(false);
  });

  it('ignores an unjudged OUTBOUND row — outbound is never classified', () => {
    const sent = makeCommMessage(ACCOUNT, { direction: 'outbound', received_at: minutesAgo(120) });
    expect(classifierStalled(makeCommHealth(), [sent], NOW).stalled).toBe(false);
  });

  it('dates the stall from when judgment stopped, not from when it was noticed', () => {
    const health = makeCommHealth({
      last_success_at: minutesAgo(120),
      last_error_at: minutesAgo(20),
    });
    const waiting = makeCommMessage(ACCOUNT, { received_at: minutesAgo(95) });

    expect(classifierStalled(health, [waiting], NOW).since).toBe(minutesAgo(95));
  });

  it('ignores an unjudged row a reply already drained — the sweep never judges one either', () => {
    // The backfill's own outbound messages clear the threads behind them, so a week of history
    // arrives already answered and permanently unjudged. `fetchUnjudgedMessages` filters these
    // out; counting them here reported a stall dated before the classifier existed.
    const cleared = makeCommMessage(ACCOUNT, {
      received_at: minutesAgo(10_000),
      cleared_at: minutesAgo(9000),
      cleared_by: 'reply',
    });
    const health = makeCommHealth({ last_success_at: minutesAgo(1) });

    expect(classifierStalled(health, [cleared], NOW)).toEqual({ stalled: false, since: null });
  });

  it('stays quiet while judgment is visibly draining a backlog', () => {
    // The sweep judges a capped batch per tick, so a first run over a week of history leaves
    // rows waiting far longer than the cadence while working exactly as designed.
    const waiting = makeCommMessage(ACCOUNT, { received_at: minutesAgo(4000) });
    const judged = makeCommMessage(ACCOUNT, {
      tier: 'today',
      judged_by: 'model',
      classified_at: minutesAgo(2),
    });

    const health = makeCommHealth({ last_success_at: minutesAgo(1) });

    expect(classifierStalled(health, [waiting, judged], NOW)).toEqual({
      stalled: false,
      since: null,
    });
  });

  it('dates a stall from the last verdict it managed, not from when the message arrived', () => {
    // An old message ingested into a dead classifier must not backdate the outage to its own
    // arrival: judgment demonstrably worked until the last verdict it wrote.
    const waiting = makeCommMessage(ACCOUNT, { received_at: minutesAgo(10_000) });
    const judged = makeCommMessage(ACCOUNT, {
      tier: 'fyi',
      judged_by: 'model',
      classified_at: minutesAgo(120),
    });

    const health = makeCommHealth({ last_success_at: minutesAgo(1) });

    expect(classifierStalled(health, [waiting, judged], NOW)).toEqual({
      stalled: true,
      since: minutesAgo(120),
    });
  });
});
