import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

import type { Logger } from './log.ts';
import type { SourceRunner } from './runner.ts';

/**
 * The poll loop. Every few seconds each source gets a tick; a tick that throws is contained here
 * so one source can never stop the other — a runner already turns an expected failure into an
 * erroring heartbeat, and this catch is for the unexpected kind.
 *
 * Every round hands each runner both a wall-clock instant and a monotonic-clock reading, captured
 * once per round so every source in it agrees on both — the same reason `now` has always been
 * generated once here rather than let each runner call `new Date()` itself. `now` is wall-clock on
 * purpose: it is what a runner reports to the server (heartbeat, anchor fallback), which the
 * server interprets, so it must track the same clock the server does, sleep/wake jumps and NTP
 * corrections included. `monotonicNowMs` exists so a runner's own backoff/deadline arithmetic does
 * NOT track those jumps — see `runner.ts`.
 */

/** Fast enough for a triage tool, slow enough to be free. The spike settled on a few seconds. */
export const POLL_INTERVAL_MS = 5000;

export async function runOnce(
  runners: readonly SourceRunner[],
  now: Date,
  monotonicNowMs: number,
  log: Logger,
): Promise<void> {
  for (const runner of runners) {
    try {
      await runner.tick(now, monotonicNowMs);
    } catch (error) {
      log.error('source tick threw — continuing with the other sources', {
        source: runner.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export interface LoopOptions {
  runners: readonly SourceRunner[];
  log: Logger;
  now?: () => Date;
  /** Monotonic clock reading in ms, for the runners' own backoff arithmetic — see `runner.ts`.
   * Defaults to `performance.now()`, which (unlike `Date`) cannot run backward. */
  monotonicNowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  shouldContinue?: () => boolean;
  intervalMs?: number;
}

export async function runLoop(options: LoopOptions): Promise<void> {
  const now = options.now ?? ((): Date => new Date());
  const monotonicNowMs = options.monotonicNowMs ?? ((): number => performance.now());
  const sleep =
    options.sleep ??
    (async (ms: number): Promise<void> => {
      await delay(ms);
    });
  const shouldContinue = options.shouldContinue ?? ((): boolean => true);
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;

  while (shouldContinue()) {
    await runOnce(options.runners, now(), monotonicNowMs(), options.log);
    if (!shouldContinue()) return;
    await sleep(intervalMs);
  }
}
