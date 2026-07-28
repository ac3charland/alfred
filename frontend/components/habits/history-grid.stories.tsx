import type { Meta, StoryObj } from '@storybook/nextjs';

import { VISUAL_TARGET, withVisualFrame } from '@/components/atoms/visual-test';
import type { Habit, HabitDayStatus, HabitEntry } from '@/lib/types';

import { HistoryGrid } from './history-grid';

/**
 * The history grid's committed visual baselines — the natural evidence for a finish whose
 * whole point is what the eye reads at a glance. Each story isolates one rule the grid exists
 * to communicate, and the forgiven / skipped pair sits deliberately side by side: the
 * baselines themselves are what keep "the run survived because the allowance paid for it" and
 * "the run survived because the day was excused" from ever being drawn the same way.
 *
 * Every story pins its own `today` and a three-week window, so a baseline never moves with the
 * calendar and stays a tight, readable crop.
 */

// 2026-07-13 is a Monday and 2026-07-30 a Thursday: three whole columns, today in the last.
const TODAY = '2026-07-30';
const WINDOW_DAYS = 14;

const HABIT: Habit = {
  id: 'habit-1',
  name: 'Morning routine',
  notes: null,
  criteria: [
    { key: 'wake', label: 'Up by 6:15', kind: 'time', target: 375, comparator: 'lte' },
    { key: 'light', label: 'Outside for light', kind: 'boolean' },
  ],
  active_days: [1, 2, 3, 4, 5, 6, 7],
  allowance: 1,
  started_on: '2026-07-13',
  archived_at: null,
  sort_order: null,
  created_at: '2026-07-13T00:00:00Z',
};

function entry(date: string, status: HabitDayStatus, note: string | null = null): HabitEntry {
  return {
    id: `entry-${date}`,
    habit_id: HABIT.id,
    entry_date: date,
    status,
    results: status === 'met' ? { wake: 364, light: true } : null,
    note,
    created_at: `${date}T08:00:00Z`,
    updated_at: `${date}T08:00:00Z`,
  };
}

/** Every day from 13 July up to (not including) today, met — the backdrop each story edits. */
function metRun(overrides: HabitEntry[] = []): Record<string, HabitEntry> {
  const rows: Record<string, HabitEntry> = {};
  for (let offset = 0; offset < 17; offset += 1) {
    const day = new Date('2026-07-13T00:00:00Z');
    day.setUTCDate(day.getUTCDate() + offset);
    const date = day.toISOString().slice(0, 10);
    rows[date] = entry(date, 'met');
  }
  for (const override of overrides) rows[override.entry_date] = override;
  return rows;
}

const meta = {
  title: 'Habits/HistoryGrid',
  component: HistoryGrid,
  decorators: [withVisualFrame],
  parameters: { visualTest: { target: VISUAL_TARGET } },
  args: { habit: HABIT, today: TODAY, windowDays: WINDOW_DAYS },
} satisfies Meta<typeof HistoryGrid>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Every cell state in one grid: met, partial, missed, skipped, unlogged, and untracked. */
export const EveryState: Story = {
  args: {
    entries: metRun([
      entry('2026-07-15', 'partial'),
      entry('2026-07-22', 'missed'),
      entry('2026-07-24', 'skipped', 'flu'),
    ]),
  },
};

/** A forgiven day: the run continues, and BOTH its links go grey to say it wasn't earned. */
export const ForgivenBridge: Story = {
  args: { entries: metRun([entry('2026-07-22', 'partial')]) },
};

/**
 * A skipped day mid-run. Paired with {@link ForgivenBridge} on purpose: same position, same
 * unbroken chain — but a skip spends nothing, so its links stay lit rather than greying.
 */
export const SkippedStaysLit: Story = {
  args: { entries: metRun([entry('2026-07-22', 'skipped', 'flu, off all week')]) },
};

/** A Sunday→Monday crossing, where a stub at each end keeps one run from reading as two. */
export const WeekWrap: Story = {
  args: { entries: metRun() },
};

/** A real break: two spent days in one rolling week exceed the allowance, so nothing crosses. */
export const RealBreak: Story = {
  args: {
    entries: metRun([entry('2026-07-22', 'missed'), entry('2026-07-23', 'missed')]),
  },
};

/** A habit that started partway through the window — the days before it are untracked. */
export const StartedMidWindow: Story = {
  args: {
    habit: { ...HABIT, started_on: '2026-07-22' },
    entries: metRun(),
  },
};

/** A weekday-only habit: the weekends are in no denominator and cost nothing. */
export const WeekdaysOnly: Story = {
  args: {
    habit: { ...HABIT, active_days: [1, 2, 3, 4, 5] },
    entries: metRun(),
  },
};
