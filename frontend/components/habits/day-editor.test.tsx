import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { DayEditor } from '@/components/habits/day-editor';
import type { HabitCriterion } from '@/lib/habits';
import { renderWithProviders } from '@/lib/test-utils';
import type { Habit } from '@/lib/types';

const logDay = jest.fn().mockResolvedValue(undefined);
const skipDay = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/stores/habits-store', () => ({
  ...jest.requireActual<typeof import('@/lib/stores/habits-store')>('@/lib/stores/habits-store'),
  useHabitActions: () => ({ logDay, skipDay, addHabit: jest.fn() }),
}));

const DATE = '2026-07-23';
const HABIT_ID = 'habit-1';

const WAKE: HabitCriterion = {
  key: 'wake',
  label: 'Up by 6:15',
  kind: 'time',
  target: 375,
  comparator: 'lte',
};
const LIGHT: HabitCriterion = { key: 'light', label: 'Outside for light', kind: 'boolean' };

const HABIT: Habit = {
  id: HABIT_ID,
  name: 'Morning routine',
  notes: null,
  // Spelled out rather than reusing the typed constants: the column is `Json`, which an
  // interface-typed value doesn't satisfy (no index signature).
  criteria: [
    { key: 'wake', label: 'Up by 6:15', kind: 'time', target: 375, comparator: 'lte' },
    { key: 'light', label: 'Outside for light', kind: 'boolean' },
  ],
  active_days: [1, 2, 3, 4, 5, 6, 7],
  allowance: 1,
  started_on: '2026-07-01',
  archived_at: null,
  sort_order: null,
  created_at: '2026-07-01T00:00:00Z',
};

function renderEditor(properties: Partial<React.ComponentProps<typeof DayEditor>> = {}) {
  const onClose = jest.fn();
  renderWithProviders(
    <DayEditor
      habitId={HABIT_ID}
      date={DATE}
      criteria={[WAKE, LIGHT]}
      results={{}}
      isSkipped={false}
      onClose={onClose}
      {...properties}
    />,
    { habits: { habits: [HABIT], entries: [], today: DATE } },
  );
  return { onClose };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DayEditor — the derived header', () => {
  it('opens on the verdict the day already carries', () => {
    renderEditor({ results: { wake: 364, light: true } });
    expect(screen.getByText('Met')).toBeInTheDocument();
  });

  it('re-derives live as criteria change, so it cannot disagree with them', async () => {
    const user = userEvent.setup();
    renderEditor({ results: { wake: 364 } });

    // One of two criteria recorded and passing → partial.
    expect(screen.getByText('Partial')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Outside for light' }));
    expect(screen.getByText('Met')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Outside for light' }));
    expect(screen.getByText('Partial')).toBeInTheDocument();
  });

  it('reads a day with nothing recorded as missed', () => {
    renderEditor();
    expect(screen.getByText('Missed')).toBeInTheDocument();
  });

  it('says Skipped, not a derived verdict, on an excused day', () => {
    renderEditor({ isSkipped: true });
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(screen.queryByText('Missed')).not.toBeInTheDocument();
  });

  it('names the allowance cost only when there is one', async () => {
    const user = userEvent.setup();
    renderEditor({ results: { wake: 364 } });
    expect(screen.getByText("Spends this week's allowance")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Outside for light' }));
    expect(screen.getByText('Earned — costs nothing')).toBeInTheDocument();
  });
});

describe('DayEditor — committing a day', () => {
  it('commits a boolean on toggle, with no Save button anywhere', async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Outside for light' }));

    await waitFor(() => {
      expect(logDay).toHaveBeenCalledWith(HABIT_ID, DATE, { light: true });
    });
  });

  it('cycles a boolean through unrecorded → yes → no → unrecorded', async () => {
    const user = userEvent.setup();
    renderEditor();
    const toggle = screen.getByRole('button', { name: 'Outside for light' });

    await user.click(toggle);
    await waitFor(() => {
      expect(logDay).toHaveBeenLastCalledWith(HABIT_ID, DATE, { light: true });
    });

    await user.click(toggle);
    await waitFor(() => {
      expect(logDay).toHaveBeenLastCalledWith(HABIT_ID, DATE, { light: false });
    });

    // Back to unrecorded: the key is REMOVED, not written as false.
    await user.click(toggle);
    await waitFor(() => {
      expect(logDay).toHaveBeenLastCalledWith(HABIT_ID, DATE, {});
    });
  });

  it('commits a measured field on blur, mapping a typed time to minutes after midnight', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.clear(screen.getByLabelText('Up by 6:15'));
    await user.type(screen.getByLabelText('Up by 6:15'), '06:04');
    await user.tab();

    await waitFor(() => {
      expect(logDay).toHaveBeenCalledWith(HABIT_ID, DATE, { wake: 364 });
    });
  });

  it('flushes a change the editor is closed on top of, rather than dropping it', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(
      <DayEditor
        habitId={HABIT_ID}
        date={DATE}
        criteria={[WAKE, LIGHT]}
        results={{}}
        isSkipped={false}
        onClose={jest.fn()}
      />,
      { habits: { habits: [HABIT], entries: [], today: DATE } },
    );

    await user.click(screen.getByRole('button', { name: 'Outside for light' }));
    // Closing inside the debounce window: the write is owed, so it fires on the way out.
    unmount();

    expect(logDay).toHaveBeenCalledWith(HABIT_ID, DATE, { light: true });
  });

  it('does not commit a measured field on every keystroke', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getByLabelText('Up by 6:15'), '06:04');

    expect(logDay).not.toHaveBeenCalled();
  });
});

describe('DayEditor — the skip flow', () => {
  it('opens a confirm step rather than skipping the day outright', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: /More options/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark as skipped…' }));

    expect(screen.getByText('Skip Thu 23 Jul?')).toBeInTheDocument();
    expect(skipDay).not.toHaveBeenCalled();
  });

  it('states the consequence in the owner’s terms before anything is committed', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: /More options/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark as skipped…' }));

    expect(
      screen.getByText(
        "This day won't count for or against the habit, and won't spend your allowance.",
      ),
    ).toBeInTheDocument();
  });

  it('keeps the commit disabled until a reason is entered', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: /More options/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark as skipped…' }));

    const commit = screen.getByRole('button', { name: 'Skip this day' });
    expect(commit).toBeDisabled();

    // Whitespace alone is not a reason.
    await user.type(screen.getByLabelText('Reason for skipping'), ' '.repeat(3));
    expect(commit).toBeDisabled();

    await user.type(screen.getByLabelText('Reason for skipping'), 'flu');
    expect(commit).toBeEnabled();
  });

  it('fills the field from a quick reason but leaves it editable', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: /More options/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark as skipped…' }));
    await user.click(screen.getByRole('button', { name: 'Illness' }));

    const field = screen.getByLabelText('Reason for skipping');
    expect(field).toHaveValue('Illness');

    await user.type(field, ' — flu');
    expect(field).toHaveValue('Illness — flu');
  });

  it('sends the trimmed reason and closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderEditor();

    await user.click(screen.getByRole('button', { name: /More options/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark as skipped…' }));
    await user.type(screen.getByLabelText('Reason for skipping'), '  flu  ');
    await user.click(screen.getByRole('button', { name: 'Skip this day' }));

    expect(skipDay).toHaveBeenCalledWith(HABIT_ID, DATE, 'flu');
    expect(onClose).toHaveBeenCalled();
  });

  it('leaves no entry when the confirm step is cancelled', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: /More options/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark as skipped…' }));
    await user.type(screen.getByLabelText('Reason for skipping'), 'flu');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(skipDay).not.toHaveBeenCalled();
    expect(screen.getByText('Thu 23 Jul')).toBeInTheDocument();
  });
});
