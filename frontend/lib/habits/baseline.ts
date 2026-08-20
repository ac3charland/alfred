import { formationStage } from '@/lib/habits/streaks';
import type { HabitStats } from '@/lib/habits/types';

/**
 * The stats rail's figures for a client that holds a trailing window of entries plus the
 * server's all-history baseline.
 *
 * `atSeed` is the window walked over the entries AS SEEDED; `live` is the same window walked
 * over the entries as they are now. At rest the two are identical, so the rail shows the
 * server's numbers exactly; every in-session edit moves the rail by the amount it moved the
 * window walk. Without a baseline the live walk IS the whole truth — a habit created this
 * session has no history outside the window.
 *
 * Two walks rather than a delta applied on write: a delta can express "+1 met day" but not
 * "you just corrected a day in the middle of the run and broke it". Re-walking the window is
 * the same code path the grid runs, so the rail and the connectors beside it can't disagree.
 */
export function statsWithBaseline(
  baseline: HabitStats | undefined,
  atSeed: HabitStats,
  live: HabitStats,
): HabitStats {
  if (baseline === undefined) return live;

  // Whichever walk saw more: `live` is short only when the run outruns the window, the baseline
  // only when the server's UTC today ran ahead of the owner's — in which case the server counted
  // an unlogged current day as spent and the local walk correctly exempted it. The two are wrong
  // in opposite, non-overlapping directions, so the larger is the one that knew more.
  const currentStreak = Math.max(
    0,
    live.currentStreak,
    baseline.currentStreak + (live.currentStreak - atSeed.currentStreak),
  );
  // The two met counts share a window, so their difference is exactly what the owner has
  // changed since the page loaded.
  const metDaysTotal = Math.max(0, baseline.metDaysTotal + (live.counts.met - atSeed.counts.met));

  return {
    currentStreak,
    longestStreak: Math.max(baseline.longestStreak, live.longestStreak, currentStreak),
    // A mean over all runs, including the still-growing current one: deltas don't compose on a
    // mean, so an in-session edit can only move it one reload later, same as before the edit.
    averageStreak: baseline.averageStreak ?? live.averageStreak,
    allowanceRemaining: live.allowanceRemaining,
    hitRate: live.hitRate,
    metDaysTotal,
    stage: formationStage(metDaysTotal),
    counts: live.counts,
  };
}
