import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';
import type { HabitStats } from '@/lib/habits';

import { StatsRail } from './stats-rail';

/**
 * The rail's committed visual baselines. Three states, deliberately — every baseline is a PNG
 * in git, and a fourth that differs only in a digit buys nothing. What each one pins is
 * something the eye has to be able to tell apart: a habit with history, one with nothing
 * banked yet (where three figures are em dashes rather than zeros), and one past the marker,
 * where the meter is full and the caption changes shape.
 *
 * Every figure is a literal, so no baseline moves with the calendar.
 */

function stats(overrides: Partial<HabitStats> = {}): HabitStats {
  return {
    currentStreak: 0,
    longestStreak: 0,
    averageStreak: null,
    allowanceRemaining: 0,
    hitRate: null,
    metDaysTotal: 0,
    stage: 'fully_deliberate',
    counts: { met: 0, partial: 0, missed: 0, skipped: 0, unknown: 0 },
    ...overrides,
  };
}

const meta = {
  title: 'Habits/StatsRail',
  component: StatsRail,
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
  args: { habitName: 'Morning routine' },
} satisfies Meta<typeof StatsRail>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A habit 190 days old, unbroken for 33 met days, 47 of them banked. */
export const Established: Story = {
  args: {
    stats: stats({
      currentStreak: 33,
      longestStreak: 33,
      averageStreak: 14,
      allowanceRemaining: 1,
      hitRate: 0.9375,
      metDaysTotal: 47,
      stage: 'nearing_automaticity',
      counts: { met: 47, partial: 1, missed: 2, skipped: 0, unknown: 0 },
    }),
  },
};

/** Day one: three figures have no value yet, and an em dash is not a zero. */
export const BrandNew: Story = { args: { stats: stats() } };

/** Past the marker: the meter fills and the caption stops counting toward ~66. */
export const PastTheMarker: Story = {
  args: {
    stats: stats({
      currentStreak: 61,
      longestStreak: 61,
      averageStreak: 5.5,
      allowanceRemaining: 1,
      hitRate: 1,
      metDaysTotal: 82,
      stage: 'possibly_established',
      counts: { met: 82, partial: 0, missed: 0, skipped: 0, unknown: 0 },
    }),
  },
};
