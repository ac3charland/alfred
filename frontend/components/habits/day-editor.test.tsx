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
const MEDITATE: HabitCriterion = {
  key: 'meditate',
  label: 'Meditate',
  kind: 'duration',
  target: 20,
  comparator: 'gte',
};

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
      isBeforeStart={false}
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

  it('names the start move ahead of the allowance on a day behind the habit’s start', () => {
    // The bigger consequence, and the only one the owner has no other way to learn.
    renderEditor({ isBeforeStart: true, results: { wake: 364 } });

    expect(screen.getByText('Logging this moves the start back')).toBeInTheDocument();
    expect(screen.queryByText("Spends this week's allowance")).not.toBeInTheDocument();
  });

  it('still derives the verdict on a pre-start day — the header is never blank', () => {
    renderEditor({ isBeforeStart: true, results: { wake: 364, light: true } });
    expect(screen.getByText('Met')).toBeInTheDocument();
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

  it('says the minutes a duration field is recorded in, beside the field', async () => {
    const user = userEvent.setup();
    renderEditor({ criteria: [MEDITATE], results: {} });

    const field = screen.getByLabelText('Meditate');
    expect(field).toHaveAccessibleDescription('min');

    // The unit is a caption on the field, not something typed into it.
    await user.type(field, '25');
    await user.tab();
    await waitFor(() => {
      expect(logDay).toHaveBeenCalledWith(HABIT_ID, DATE, { meditate: 25 });
    });
  });

  it('leaves a count field unitless, since its label carries the unit', () => {
    renderEditor({
      criteria: [{ key: 'glasses', label: 'Glasses', kind: 'count', target: 3, comparator: 'gte' }],
    });

    expect(screen.getByLabelText('Glasses')).toHaveAccessibleDescription('');
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
        isBeforeStart={false}
        onClose={jest.fn()}
      />,
      { habits: { habits: [HABIT], entries: [], today: DATE } },
    );

    await user.click(screen.getByRole('button', { name: 'Outside for light' }));
    // Closing inside the debounce window: the write is owed, so it fires on the way out.
    unmount();

    expect(logDay).toHaveBeenCalledWith(HABIT_ID, DATE, { light: true });
  });

  it('writes nothing when a day is only opened and looked at', async () => {
    const user = userEvent.setup();
    renderEditor();

    // Focus lands in the field, then leaves it — the shape of opening the ⋯ menu. An
    // untouched empty field must not log an empty day, or looking marks the day missed.
    await user.click(screen.getByLabelText('Up by 6:15'));
    await user.tab();

    expect(logDay).not.toHaveBeenCalled();
  });

  it('does not re-send an unchanged value when Enter is followed by a blur', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getByLabelText('Up by 6:15'), '06:04');
    await user.keyboard('{Enter}');
    await user.tab();

    await waitFor(() => {
      expect(logDay).toHaveBeenCalledTimes(1);
    });
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

  it('offers no one-tap reason — the whole point is that a human writes it', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: /More options/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Mark as skipped…' }));

    // A suggestion chip would hand back the friction this step exists to charge.
    expect(screen.getByLabelText('Reason for skipping')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Illness' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Travel' })).not.toBeInTheDocument();
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

/**
 * Editing a criterion never rewrites a logged day — but re-logging one is a write, and the route
 * re-scores it against whatever the definition says NOW. So when a day's frozen verdict no longer
 * matches its own results, the editor says so: the re-score stays available, it stops being silent.
 */
describe('DayEditor — a day the criteria moved under', () => {
  it('names what a re-log would cost a day whose verdict no longer matches the terms', () => {
    // 06:50 passed the old 07:00 target and was frozen `met` back when `wake` was the only
    // criterion. The target is now 06:15 and a second criterion has since been added, so nothing
    // on this day passes any more.
    renderEditor({ results: { wake: 410 }, storedStatus: 'met' });

    expect(
      screen.getByText(
        'Logged met under the earlier terms — changing this day now re-scores it as missed.',
      ),
    ).toBeInTheDocument();
  });

  it('says nothing when the stored verdict still matches the current terms', () => {
    renderEditor({ results: { wake: 364, light: true }, storedStatus: 'met' });

    expect(screen.queryByText(/under the earlier terms/)).not.toBeInTheDocument();
  });

  it('says nothing on a day that was never logged', () => {
    renderEditor({ results: {} });

    expect(screen.queryByText(/under the earlier terms/)).not.toBeInTheDocument();
  });

  // A skipped day carries no verdict about the criteria at all, so there is nothing to restate.
  it('says nothing on an excused day', () => {
    renderEditor({ results: { wake: 410 }, storedStatus: 'met', isSkipped: true });

    expect(screen.queryByText(/under the earlier terms/)).not.toBeInTheDocument();
  });

  // A criterion added later has no value on any older day, so every one of them would drop.
  it('names the drop when a newly added criterion has no value on this day', () => {
    renderEditor({ results: { wake: 364 }, storedStatus: 'met' });

    expect(screen.getByText(/re-scores it as partial/)).toBeInTheDocument();
  });

  it('still lets the day be re-recorded — the notice explains, it does not block', async () => {
    const user = userEvent.setup();
    renderEditor({ results: { wake: 410, light: true }, storedStatus: 'met' });

    await user.click(screen.getByRole('button', { name: 'Outside for light' }));

    await waitFor(() => {
      expect(logDay).toHaveBeenCalled();
    });
  });
});
