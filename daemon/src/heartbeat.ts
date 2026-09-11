/**
 * When a source is allowed to say "still here".
 *
 * The poll loop runs every few seconds, so one beat per poll would be tens of thousands of
 * requests a day to move an indicator whose thresholds are in minutes. Liveness therefore
 * COALESCES: at most one POST per source per minute when there is nothing to send. A batch that
 * carries messages goes immediately and counts as that source's beat.
 *
 * The first tick is always due, so a fresh start (or a restart after a crash) reports liveness at
 * once rather than looking stale for a minute.
 */

export const HEARTBEAT_INTERVAL_MS = 60_000;

export interface HeartbeatSchedule {
  /** True when this source owes a beat — nothing has been sent for it within the interval. */
  due(sourceKey: string, now: Date): boolean;
  /** Records that something was sent for this source, messages or not. */
  record(sourceKey: string, now: Date): void;
}

export function createHeartbeatSchedule(
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): HeartbeatSchedule {
  const lastSentAt = new Map<string, number>();

  return {
    due(sourceKey, now) {
      const last = lastSentAt.get(sourceKey);
      return last === undefined || now.getTime() - last >= intervalMs;
    },
    record(sourceKey, now) {
      lastSentAt.set(sourceKey, now.getTime());
    },
  };
}
