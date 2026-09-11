import { POLL_INTERVAL_MS, runLoop, runOnce } from './daemon.ts';
import { createLogger } from './log.ts';
import type { SourceRunner } from './runner.ts';

const NOW = new Date('2026-09-09T12:00:00.000Z');

/** Log output is captured and never asserted on; these tests are about the loop. */
const captured: string[] = [];
const silent = createLogger({
  out: (line) => captured.push(line),
  err: (line) => captured.push(line),
});

/**
 * `monotonics` is optional so the many tests below that only care about wall-clock `now` don't
 * have to thread a throwaway array through — see the `runner.ts` doc comment on `tick` for why a
 * source is handed both a wall-clock instant and a separate monotonic reading every round.
 */
function recordingRunner(
  key: 'imessage' | 'workmail',
  ticks: Date[],
  monotonics: number[] = [],
): SourceRunner {
  return {
    key,
    label: key,
    tick: (now, monotonicNowMs) => {
      ticks.push(now);
      monotonics.push(monotonicNowMs);
      return Promise.resolve();
    },
  };
}

describe('runOnce', () => {
  it('polls every source at the same instant, on both clocks', async () => {
    const first: Date[] = [];
    const second: Date[] = [];
    const firstMonotonic: number[] = [];
    const secondMonotonic: number[] = [];

    await runOnce(
      [
        recordingRunner('imessage', first, firstMonotonic),
        recordingRunner('workmail', second, secondMonotonic),
      ],
      NOW,
      123.456,
      silent,
    );

    expect(first).toEqual([NOW]);
    expect(second).toEqual([NOW]);
    expect(firstMonotonic).toEqual([123.456]);
    expect(secondMonotonic).toEqual([123.456]);
  });

  it('keeps polling the other source when one blows up', async () => {
    const survivor: Date[] = [];
    const exploding: SourceRunner = {
      key: 'imessage',
      label: 'iMessage',
      tick: () => Promise.reject(new Error('unhandled')),
    };

    await runOnce([exploding, recordingRunner('workmail', survivor)], NOW, 123.456, silent);

    expect(survivor).toEqual([NOW]);
  });
});

describe('runLoop', () => {
  it('polls, waits the interval, and polls again until told to stop', async () => {
    const ticks: Date[] = [];
    const monotonics: number[] = [];
    const slept: number[] = [];
    let rounds = 0;
    let monotonic = 0;

    await runLoop({
      runners: [recordingRunner('imessage', ticks, monotonics)],
      log: silent,
      now: () => NOW,
      // A wall clock fixed at NOW would mask a bug that reads the monotonic reading from `now`
      // instead of its own source — advance this independently so the two can't be confused.
      monotonicNowMs: () => {
        monotonic += 1;
        return monotonic;
      },
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
      shouldContinue: () => {
        rounds += 1;
        return rounds <= 3;
      },
    });

    expect(ticks).toHaveLength(2);
    expect(slept).toEqual([POLL_INTERVAL_MS]);
    // One monotonic reading per round, taken once and handed to every runner — same shape as
    // `now`, and advancing on its own schedule rather than tracking the (here, frozen) wall clock.
    expect(monotonics).toEqual([1, 2]);
  });

  it('does not sleep after the last round', async () => {
    const slept: number[] = [];
    let first = true;

    await runLoop({
      runners: [],
      log: silent,
      now: () => NOW,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
      shouldContinue: () => {
        const answer = first;
        first = false;
        return answer;
      },
    });

    expect(slept).toEqual([]);
  });

  it('defaults the monotonic source to a real clock when none is injected', async () => {
    const ticks: Date[] = [];
    const monotonics: number[] = [];
    let first = true;

    await runLoop({
      runners: [recordingRunner('imessage', ticks, monotonics)],
      log: silent,
      now: () => NOW,
      sleep: () => Promise.resolve(),
      shouldContinue: () => {
        const answer = first;
        first = false;
        return answer;
      },
    });

    expect(monotonics).toHaveLength(1);
    expect(typeof monotonics[0]).toBe('number');
  });
});
