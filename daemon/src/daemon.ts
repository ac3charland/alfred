import { setTimeout as delay } from 'node:timers/promises';

import type { Logger } from './log.ts';
import type { SourceRunner } from './runner.ts';

/**
 * The poll loop. Every few seconds each source gets a tick; a tick that throws is contained here
 * so one source can never stop the other — a runner already turns an expected failure into an
 * erroring heartbeat, and this catch is for the unexpected kind.
 */

/** Fast enough for a triage tool, slow enough to be free. The spike settled on a few seconds. */
export const POLL_INTERVAL_MS = 5000;

export async function runOnce(
  runners: readonly SourceRunner[],
  now: Date,
  log: Logger,
): Promise<void> {
  for (const runner of runners) {
    try {
      await runner.tick(now);
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
  sleep?: (ms: number) => Promise<void>;
  shouldContinue?: () => boolean;
  intervalMs?: number;
}

export async function runLoop(options: LoopOptions): Promise<void> {
  const now = options.now ?? ((): Date => new Date());
  const sleep =
    options.sleep ??
    (async (ms: number): Promise<void> => {
      await delay(ms);
    });
  const shouldContinue = options.shouldContinue ?? ((): boolean => true);
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;

  while (shouldContinue()) {
    await runOnce(options.runners, now(), options.log);
    if (!shouldContinue()) return;
    await sleep(intervalMs);
  }
}
