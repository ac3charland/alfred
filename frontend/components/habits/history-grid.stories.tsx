import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import { screen, userEvent, within } from 'storybook/test';

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

/**
 * A fixed-width box around the grid, so a baseline can show what it does with a width it does
 * NOT choose. Every other story renders inside the shrink-wrapped visual frame, which is
 * exactly the columns' own width — the one width at which neither anchoring rule can show.
 */
function withWidth(widthClass: string): Decorator {
  return (Story) => (
    <div className={widthClass}>
      <Story />
    </div>
  );
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

/**
 * Given more width than it needs, the grid pushes to the right edge rather than the left: the
 * newest column is the one the owner came to see, so it is the one the eye lands on.
 */
export const HugsTheRightEdge: Story = {
  decorators: [withWidth('w-[420px]')],
  args: { entries: metRun() },
};

/**
 * Given less, it scrolls — and opens on the newest end. A quarter in a phone-width box: the
 * lit run and today's teal ring are what's on screen, with the untracked weeks before the
 * habit began pushed off to the left, one gesture away. The evidence is what is NOT drawn
 * here: a strip that opened at the oldest week would be a wall of dashed squares.
 */
export const OpensOnTheNewestWeek: Story = {
  decorators: [withWidth('w-[280px]')],
  args: { entries: metRun(), windowDays: 84 },
};

/** A phone, where the touch layout takes over: thumb-sized squares and a bottom-sheet editor. */
const PHONE = { width: 390, height: 844 } as const;

/**
 * On a phone the squares grow to 38px on a 44px pitch — a thumb-sized target with no dead gap
 * between neighbours — and the strip still opens on the newest week, the older ones a scroll away.
 */
export const TouchGrid: Story = {
  parameters: { visualTest: { target: VISUAL_TARGET, viewport: PHONE } },
  args: { entries: metRun([entry('2026-07-22', 'partial'), entry('2026-07-24', 'skipped')]) },
};

/** The habit the sheet stories open: one of each control the editor draws on a phone. */
const ROUTINE: Habit = {
  ...HABIT,
  criteria: [
    { key: 'wake', label: 'Up by 6:15', kind: 'time', target: 375, comparator: 'lte' },
    { key: 'light', label: 'Outside for light', kind: 'boolean' },
    { key: 'stretch', label: 'Stretch', kind: 'duration', target: 10, comparator: 'gte' },
    { key: 'phone', label: 'No phone in bed', kind: 'boolean' },
  ],
};

/** Open a day's sheet the way a thumb does: a tap on its square. */
async function openDay(canvasElement: HTMLElement, date: string) {
  const square = canvasElement.querySelector(`[data-date="${date}"] button`);
  if (!(square instanceof HTMLElement)) throw new Error(`no square for ${date}`);
  await userEvent.click(square);
  return screen.findByRole('dialog');
}

/**
 * The logging sheet: a recorded time, a yes/no answered Yes, an empty duration, and a yes/no
 * answered No — every control a criterion can draw, each 44px tall, over the dimmed page.
 */
export const TouchSheetLogging: Story = {
  parameters: { visualTest: { target: 'body', viewport: PHONE } },
  args: {
    habit: ROUTINE,
    entries: metRun([
      {
        ...entry(TODAY, 'partial'),
        results: { wake: 364, light: true, phone: false },
      },
    ]),
  },
  play: async ({ canvasElement }) => {
    await openDay(canvasElement, TODAY);
  },
};

/** The skip step inside the sheet: the full-width reason field, and two buttons sharing a row. */
export const TouchSheetSkipStep: Story = {
  parameters: { visualTest: { target: 'body', viewport: PHONE } },
  args: { habit: ROUTINE, entries: metRun() },
  play: async ({ canvasElement }) => {
    const sheet = await openDay(canvasElement, TODAY);
    await userEvent.click(within(sheet).getByRole('button', { name: /More options/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark as skipped…' }));
    await screen.findByLabelText('Reason for skipping');
  },
};

/** An excused day: its reason stands in for the criteria, above the cost line and Done. */
export const TouchSheetSkipped: Story = {
  parameters: { visualTest: { target: 'body', viewport: PHONE } },
  args: {
    habit: ROUTINE,
    entries: metRun([entry('2026-07-24', 'skipped', 'Flu — in bed all day')]),
  },
  play: async ({ canvasElement }) => {
    await openDay(canvasElement, '2026-07-24');
  },
};
