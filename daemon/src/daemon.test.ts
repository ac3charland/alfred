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

function recordingRunner(key: 'imessage' | 'workmail', ticks: Date[]): SourceRunner {
  return {
    key,
    label: key,
    tick: (now) => {
      ticks.push(now);
      return Promise.resolve();
    },
  };
}

describe('runOnce', () => {
  it('polls every source at the same instant', async () => {
    const first: Date[] = [];
    const second: Date[] = [];

    await runOnce(
      [recordingRunner('imessage', first), recordingRunner('workmail', second)],
      NOW,
      silent,
    );

    expect(first).toEqual([NOW]);
    expect(second).toEqual([NOW]);
  });

  it('keeps polling the other source when one blows up', async () => {
    const survivor: Date[] = [];
    const exploding: SourceRunner = {
      key: 'imessage',
      label: 'iMessage',
      tick: () => Promise.reject(new Error('unhandled')),
    };

    await runOnce([exploding, recordingRunner('workmail', survivor)], NOW, silent);

    expect(survivor).toEqual([NOW]);
  });
});

describe('runLoop', () => {
  it('polls, waits the interval, and polls again until told to stop', async () => {
    const ticks: Date[] = [];
    const slept: number[] = [];
    let rounds = 0;

    await runLoop({
      runners: [recordingRunner('imessage', ticks)],
      log: silent,
      now: () => NOW,
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
});
