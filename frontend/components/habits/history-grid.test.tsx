import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { HistoryGrid } from '@/components/habits/history-grid';
import { renderWithProviders } from '@/lib/test-utils';
import type { Habit, HabitDayStatus, HabitEntry } from '@/lib/types';

// 2026-07-13 is a Monday and 2026-07-30 a Thursday, so a 14-day window renders exactly three
// whole columns: 13–19 July, 20–26 July, and the current week padded out to Sunday 2 August.
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

function entry(
  date: string,
  status: HabitDayStatus,
  extras: Partial<HabitEntry> = {},
): [string, HabitEntry] {
  return [
    date,
    {
      id: `entry-${date}`,
      habit_id: HABIT.id,
      entry_date: date,
      status,
      results: status === 'met' ? { wake: 364, light: true } : null,
      note: null,
      created_at: `${date}T08:00:00Z`,
      updated_at: `${date}T08:00:00Z`,
      ...extras,
    },
  ];
}

/** Every day of the window met, so a fixture only has to name its exceptions. */
function allMet(from: string, days: number): Record<string, HabitEntry> {
  const rows: Record<string, HabitEntry> = {};
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(`${from}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    const iso = date.toISOString().slice(0, 10);
    const [key, value] = entry(iso, 'met');
    rows[key] = value;
  }
  return rows;
}

function renderGrid(
  entries: Record<string, HabitEntry>,
  habit: Habit = HABIT,
  today: string = TODAY,
) {
  return renderWithProviders(
    <HistoryGrid habit={habit} entries={entries} today={today} windowDays={WINDOW_DAYS} />,
    { habits: { habits: [habit], entries: Object.values(entries), today } },
  );
}

/** The wrapper for one calendar day, keyed by the data attribute the cell carries. */
function cell(date: string): HTMLElement {
  const found = document.querySelector(`[data-date="${CSS.escape(date)}"]`);
  if (found === null) throw new Error(`no cell rendered for ${date}`);
  return found as HTMLElement;
}

function connectorTone(date: string, place: 'out' | 'wrap-in'): string | undefined {
  return (
    cell(date)
      .querySelector(`[data-connector="${CSS.escape(place)}"]`)
      ?.getAttribute('tone') ?? undefined
  );
}

function connector(date: string, place: 'out' | 'wrap-in'): Element | null {
  return cell(date).querySelector(`[data-connector="${CSS.escape(place)}"]`);
}

/** Everything drawn INSIDE a day's square, ignoring the connectors that sit outside it. */
function decorations(date: string): Element[] {
  const button = cell(date).querySelector('button');
  if (button === null) throw new Error(`no button rendered for ${date}`);
  return [...button.querySelectorAll('[aria-hidden="true"]')];
}

describe('HistoryGrid — what is reachable', () => {
  it('gives every scored day a button carrying its date, status and recorded values', () => {
    renderGrid(Object.fromEntries([entry('2026-07-13', 'met')]));

    expect(
      screen.getByRole('button', {
        name: 'Monday 13 July — met. Up by 6:15: met (06:04). Outside for light: met.',
      }),
    ).toBeInTheDocument();
  });

  it('names an unlogged day as not logged', () => {
    renderGrid({});
    expect(screen.getByRole('button', { name: 'Monday 13 July — not logged' })).toBeInTheDocument();
  });

  it('names a skipped day with the reason it was excused', () => {
    renderGrid(Object.fromEntries([entry('2026-07-14', 'skipped', { note: 'flu, off all week' })]));
    expect(
      screen.getByRole('button', { name: 'Tuesday 14 July — skipped: flu, off all week' }),
    ).toBeInTheDocument();
  });

  it('leaves a future day out of the tab order entirely — there is nothing to open', () => {
    renderGrid({});
    const grid = screen.getByRole('group', { name: 'Morning routine history' });
    const tomorrow = within(grid).queryByRole('button', { name: /31 July/ });
    expect(tomorrow).toBeNull();
    expect(cell('2026-07-31').querySelector('button')).toBeNull();
  });

  it('offers a day before the habit started, naming what filling it will do', () => {
    const later: Habit = { ...HABIT, started_on: '2026-07-20' };
    renderGrid({}, later);

    expect(
      screen.getByRole('button', {
        name: 'Monday 13 July — before this habit started. Log it to start the habit here',
      }),
    ).toBeInTheDocument();
  });

  it('leaves a day off the weekday set out of the tab order, whatever the start date', () => {
    // No start date makes a Saturday count, so there is nothing to offer on one.
    const weekdays: Habit = { ...HABIT, active_days: [1, 2, 3, 4, 5], started_on: '2026-07-20' };
    renderGrid({}, weekdays);
    expect(cell('2026-07-18').querySelector('button')).toBeNull();
    expect(cell('2026-07-13').querySelector('button')).not.toBeNull();
  });

  it('renders one cell per day of the padded window, so every column is a whole week', () => {
    renderGrid({});
    expect(document.querySelectorAll('[data-date]')).toHaveLength(21);
    expect(cell('2026-07-13')).toBeInTheDocument();
    expect(cell('2026-08-02')).toBeInTheDocument();
  });
});

/** The strip the columns scroll inside — everything outside it stays put. */
function scroller(): HTMLElement {
  return screen.getByTestId('history-scroll');
}

describe('HistoryGrid — landing on the most recent week', () => {
  it('scrolls the squares alone, leaving the weekday labels outside the scrolling strip', () => {
    renderGrid({});

    // The labels are the fixed edge the columns slide past: scrolling back through a quarter
    // must not take the row legend with it.
    expect(scroller()).toContainElement(
      screen.getByRole('group', { name: 'Morning routine history' }),
    );
    expect(scroller()).not.toContainElement(screen.getByTestId('history-weekdays'));
  });

  it('opens on the newest end, with the columns still running oldest to newest', () => {
    renderGrid({});

    // A right-to-left scroll container starts at its RIGHT edge, so the browser lands the view
    // on today without a line of script — and keeps doing it as the box is resized.
    expect(scroller()).toHaveAttribute('dir', 'rtl');
    // The squares themselves stay left-to-right, so May is still drawn left of July.
    expect(screen.getByRole('group', { name: 'Morning routine history' })).toHaveAttribute(
      'dir',
      'ltr',
    );
  });

  it('hugs the right edge when the history is too short to fill the space it is given', () => {
    renderGrid({});

    // Nothing to scroll here, so the newest column is kept on the right by the layout instead.
    expect(scroller().parentElement).toHaveClass('justify-end');
  });
});

describe('HistoryGrid — the connectors', () => {
  it('lights the link between two earned days', () => {
    renderGrid(allMet('2026-07-13', 18));
    expect(connector('2026-07-13', 'out')).toHaveAttribute('data-tone', 'streak');
  });

  it('greys both links around a forgiven day, keeping their full width', () => {
    const entries = {
      ...allMet('2026-07-13', 18),
      ...Object.fromEntries([entry('2026-07-15', 'partial')]),
    };
    renderGrid(entries);

    expect(connector('2026-07-14', 'out')).toHaveAttribute('data-tone', 'bridge');
    expect(connector('2026-07-15', 'out')).toHaveAttribute('data-tone', 'bridge');
    expect(connector('2026-07-16', 'out')).toHaveAttribute('data-tone', 'streak');
  });

  it('keeps a skipped day’s links lit — a skip costs nothing, so nothing greys', () => {
    const entries = {
      ...allMet('2026-07-13', 18),
      ...Object.fromEntries([entry('2026-07-15', 'skipped')]),
    };
    renderGrid(entries);

    expect(connector('2026-07-14', 'out')).toHaveAttribute('data-tone', 'streak');
    expect(connector('2026-07-15', 'out')).toHaveAttribute('data-tone', 'streak');
  });

  it('draws no link across a real break', () => {
    // Two spent days in one rolling window exceed the allowance of 1.
    const entries = {
      ...allMet('2026-07-13', 18),
      ...Object.fromEntries([entry('2026-07-15', 'missed'), entry('2026-07-16', 'missed')]),
    };
    renderGrid(entries);

    expect(connector('2026-07-15', 'out')).toBeNull();
    expect(connector('2026-07-16', 'out')).toBeNull();
    expect(connector('2026-07-17', 'out')).toHaveAttribute('data-tone', 'streak');
  });

  it('grows a stub at each end of a Sunday→Monday crossing', () => {
    renderGrid(allMet('2026-07-13', 18));

    // Sunday's own outward stub, and the Monday that inherits its tone.
    expect(connector('2026-07-19', 'out')).toHaveAttribute('data-tone', 'streak');
    expect(connector('2026-07-20', 'wrap-in')).toHaveAttribute('data-tone', 'streak');
  });

  it('carries a forgiven crossing’s grey into the Monday stub', () => {
    const entries = {
      ...allMet('2026-07-13', 18),
      ...Object.fromEntries([entry('2026-07-20', 'partial')]),
    };
    renderGrid(entries);

    expect(connector('2026-07-19', 'out')).toHaveAttribute('data-tone', 'bridge');
    expect(connector('2026-07-20', 'wrap-in')).toHaveAttribute('data-tone', 'bridge');
  });

  it('draws nothing out of today, whose tomorrow has not happened', () => {
    renderGrid(allMet('2026-07-13', 18));
    expect(connector(TODAY, 'out')).toBeNull();
    expect(connectorTone(TODAY, 'out')).toBeUndefined();
  });
});

describe('HistoryGrid — what a square carries', () => {
  it('draws nothing inside a partial or a missed square — the plate and the legend say it', () => {
    renderGrid(Object.fromEntries([entry('2026-07-14', 'partial'), entry('2026-07-15', 'missed')]));

    // Each of these has its own hue and its own legend swatch, so a mark on the face is one
    // more thing to decode for a distinction the colour already draws.
    expect(decorations('2026-07-14')).toHaveLength(0);
    expect(decorations('2026-07-15')).toHaveLength(0);
  });

  it('keeps the dash on a skipped square, which shares its neutral plate with an unlogged day', () => {
    renderGrid(Object.fromEntries([entry('2026-07-14', 'skipped', { note: 'flu' })]));

    // The one pair colour CANNOT separate: excused and unlogged are the same neutral plate.
    expect(decorations('2026-07-14')).toHaveLength(1);
    expect(decorations('2026-07-15')).toHaveLength(0);
  });
});

describe('HistoryGrid — opening the editor', () => {
  it('opens the day editor on the cell that was tapped', async () => {
    const user = userEvent.setup();
    renderGrid(Object.fromEntries([entry('2026-07-13', 'met')]));

    await user.click(screen.getByRole('button', { name: /Monday 13 July/ }));

    expect(screen.getByText('Mon 13 Jul')).toBeInTheDocument();
    expect(screen.getByLabelText('Up by 6:15')).toHaveValue('06:04');
    expect(screen.getByRole('button', { name: 'Outside for light' })).toBeInTheDocument();
  });

  it('opens a pre-start day, saying that recording it will move the start here', async () => {
    const user = userEvent.setup();
    const later: Habit = { ...HABIT, started_on: '2026-07-20' };
    renderGrid({}, later);

    await user.click(screen.getByRole('button', { name: /Monday 13 July/ }));

    expect(screen.getByText('Mon 13 Jul')).toBeInTheDocument();
    // The consequence is named where the cost of an ordinary day is named — the owner should
    // not have to discover that a backfill rewrote the habit's start.
    expect(screen.getByText('Logging this moves the start back')).toBeInTheDocument();
  });

  it('opens on Enter from the keyboard and returns focus to the cell on Escape', async () => {
    const user = userEvent.setup();
    renderGrid(Object.fromEntries([entry('2026-07-13', 'met')]));
    const target = screen.getByRole('button', { name: /Monday 13 July/ });

    target.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Mon 13 Jul')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByText('Mon 13 Jul')).not.toBeInTheDocument();
    expect(target).toHaveFocus();
  });
});
