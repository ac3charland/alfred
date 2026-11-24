import { screen, waitFor, within } from '@testing-library/react';
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
      skipReason={null}
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

  it('shows the reason a skipped day was excused, in place of the criteria', () => {
    renderEditor({ isSkipped: true, skipReason: 'flu, off all week' });

    expect(screen.getByText('flu, off all week')).toBeInTheDocument();
    // The criteria never produced this verdict, so re-showing them would misrepresent why the
    // day reads Skipped.
    expect(screen.queryByRole('button', { name: 'Outside for light' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Up by 6:15')).not.toBeInTheDocument();
  });

  it('shows no reason line on a skipped day that was excused without one', () => {
    renderEditor({ isSkipped: true, skipReason: null });

    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Outside for light' })).not.toBeInTheDocument();
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
        skipReason={null}
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

/** A touch-mode yes/no criterion: the group its label names, and its two answers. */
function yesNo(label: string) {
  const group = screen.getByRole('group', { name: label });
  return {
    group,
    yes: within(group).getByRole('button', { name: 'Yes' }),
    no: within(group).getByRole('button', { name: 'No' }),
  };
}

describe('DayEditor — touch mode', () => {
  const GLASSES: HabitCriterion = {
    key: 'glasses',
    label: 'Glasses of water',
    kind: 'count',
    target: 3,
    comparator: 'gte',
  };

  function renderTouch(properties: Partial<React.ComponentProps<typeof DayEditor>> = {}) {
    const onClose = jest.fn();
    const view = renderWithProviders(
      <DayEditor
        habitId={HABIT_ID}
        date={DATE}
        criteria={[WAKE, LIGHT]}
        results={{}}
        isSkipped={false}
        skipReason={null}
        isBeforeStart={false}
        onClose={onClose}
        touch
        habitName="Morning routine"
        {...properties}
      />,
      { habits: { habits: [HABIT], entries: [], today: DATE } },
    );
    return { onClose, unmount: view.unmount };
  }

  it('names the habit under the date, since the sheet covers the card that said so', () => {
    renderTouch();
    expect(screen.getByText('Thu 23 Jul')).toBeInTheDocument();
    expect(screen.getByText('Morning routine')).toBeInTheDocument();
  });

  it('offers a yes/no criterion as two buttons, neither lit while unrecorded', () => {
    renderTouch();
    const { yes, no } = yesNo('Outside for light');
    expect(yes).toHaveAttribute('aria-pressed', 'false');
    expect(no).toHaveAttribute('aria-pressed', 'false');
    // The cycling box is the desktop control only.
    expect(screen.queryByRole('button', { name: 'Outside for light' })).not.toBeInTheDocument();
  });

  it('records the answer tapped and lights it, the verdict and cost line following', async () => {
    const user = userEvent.setup();
    renderTouch({ results: { wake: 364 } });
    const { yes, no } = yesNo('Outside for light');

    await user.click(yes);
    expect(yes).toHaveAttribute('aria-pressed', 'true');
    expect(no).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Met')).toBeInTheDocument();
    expect(screen.getByText('Earned — costs nothing')).toBeInTheDocument();
    await waitFor(() => {
      expect(logDay).toHaveBeenLastCalledWith(HABIT_ID, DATE, { wake: 364, light: true });
    });

    await user.click(no);
    expect(no).toHaveAttribute('aria-pressed', 'true');
    expect(yes).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText("Spends this week's allowance")).toBeInTheDocument();
    await waitFor(() => {
      expect(logDay).toHaveBeenLastCalledWith(HABIT_ID, DATE, { wake: 364, light: false });
    });
  });

  it('clears the criterion when the lit answer is tapped again, removing its key', async () => {
    const user = userEvent.setup();
    renderTouch({ results: { light: false } });
    const { yes, no } = yesNo('Outside for light');
    expect(no).toHaveAttribute('aria-pressed', 'true');

    await user.click(no);

    expect(no).toHaveAttribute('aria-pressed', 'false');
    expect(yes).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => {
      expect(logDay).toHaveBeenLastCalledWith(HABIT_ID, DATE, {});
    });
  });

  it('sends Yes-then-No inside the debounce as one write, recording No', async () => {
    const user = userEvent.setup();
    renderTouch();
    const { yes, no } = yesNo('Outside for light');

    await user.click(yes);
    await user.click(no);

    await waitFor(() => {
      expect(logDay).toHaveBeenCalledWith(HABIT_ID, DATE, { light: false });
    });
    expect(logDay).toHaveBeenCalledTimes(1);
  });

  it('closes on Done, which saves nothing of its own — every change already committed', async () => {
    const user = userEvent.setup();
    const { onClose } = renderTouch();

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(logDay).not.toHaveBeenCalled();
  });

  it('saves a typed value the editor is closed on, though the field never blurred', async () => {
    const user = userEvent.setup();
    const { unmount } = renderTouch({ criteria: [GLASSES] });

    await user.type(screen.getByLabelText('Glasses of water'), '4');
    // No blur, no Enter: iOS Safari need not blur a field when a button is tapped, and a removed
    // element fires no blur at all.
    unmount();

    expect(logDay).toHaveBeenCalledTimes(1);
    expect(logDay).toHaveBeenCalledWith(HABIT_ID, DATE, { glasses: 4 });
  });

  it('folds a typed value and a pending answer into the one write sent on close', async () => {
    const user = userEvent.setup();
    const { unmount } = renderTouch({ criteria: [GLASSES, LIGHT] });

    await user.click(yesNo('Outside for light').yes);
    await user.type(screen.getByLabelText('Glasses of water'), '4');
    unmount();

    expect(logDay).toHaveBeenCalledTimes(1);
    expect(logDay).toHaveBeenCalledWith(HABIT_ID, DATE, { light: true, glasses: 4 });
  });

  it('still writes nothing when a day is only opened and closed', () => {
    const { unmount } = renderTouch({ criteria: [GLASSES, WAKE] });
    unmount();
    expect(logDay).not.toHaveBeenCalled();
  });

  it('keeps a typed value when the skip step replaces the criteria', async () => {
    const user = userEvent.setup();
    renderTouch({ criteria: [GLASSES] });

    await user.type(screen.getByLabelText('Glasses of water'), '4');
    // Opening the menu by keyboard keeps focus in the field until the rows unmount.
    screen.getByLabelText('Glasses of water').focus();
    await user.click(screen.getByRole('button', { name: /More options/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mark as skipped…' }));

    await waitFor(() => {
      expect(logDay).toHaveBeenCalledWith(HABIT_ID, DATE, { glasses: 4 });
    });
  });

  it('draws every control and button at least 44px tall', () => {
    renderTouch({ criteria: [WAKE, LIGHT, GLASSES] });

    for (const control of [
      screen.getByLabelText('Up by 6:15'),
      screen.getByLabelText('Glasses of water'),
      yesNo('Outside for light').yes,
      yesNo('Outside for light').no,
      screen.getByRole('button', { name: /More options/ }),
      screen.getByRole('button', { name: 'Done' }),
    ]) {
      expect(control).toHaveClass('h-11');
    }
    expect(screen.getByRole('button', { name: /More options/ })).toHaveClass('w-11');
    expect(screen.getByRole('button', { name: 'Done' })).toHaveClass('w-full');
  });

  it('gives a number field a decimal keypad whose return key says done', () => {
    renderTouch({ criteria: [GLASSES] });
    const field = screen.getByLabelText('Glasses of water');
    expect(field).toHaveAttribute('inputmode', 'decimal');
    expect(field).toHaveAttribute('enterkeyhint', 'done');
    expect(field).toHaveClass('w-[72px]', 'text-base', 'font-mono');
  });

  it('gives the ⋯ menu’s item a thumb-sized row', async () => {
    const user = userEvent.setup();
    renderTouch();
    await user.click(screen.getByRole('button', { name: /More options/ }));
    expect(await screen.findByRole('menuitem', { name: 'Mark as skipped…' })).toHaveClass(
      'min-h-11',
    );
  });

  it('sizes the skip step for a thumb, and closes once the day is skipped', async () => {
    const user = userEvent.setup();
    const { onClose } = renderTouch();
    await user.click(screen.getByRole('button', { name: /More options/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mark as skipped…' }));

    const reason = screen.getByLabelText('Reason for skipping');
    // The sheet covers the card, so the skip step names the habit too.
    expect(screen.getByText('Skip Thu 23 Jul?')).toBeInTheDocument();
    expect(screen.getByText('Morning routine')).toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const skip = screen.getByRole('button', { name: 'Skip this day' });
    expect(reason).toHaveFocus();
    expect(reason).toHaveClass('h-11', 'w-full', 'text-base');
    expect(cancel).toHaveClass('h-11', 'flex-1');
    expect(skip).toHaveClass('h-11', 'flex-1');

    await user.type(reason, 'flu');
    await user.click(skip);
    expect(skipDay).toHaveBeenCalledWith(HABIT_ID, DATE, 'flu');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a skipped day’s reason in place of the criteria, with Done beneath', () => {
    renderTouch({ isSkipped: true, skipReason: 'Flu — in bed all day' });
    expect(screen.getByText('Flu — in bed all day')).toHaveClass('text-[15px]');
    expect(screen.queryByRole('group', { name: 'Outside for light' })).not.toBeInTheDocument();
    expect(screen.getByText('Excused — costs nothing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('keeps the desktop editor free of a Done button', () => {
    renderEditor();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });
});

describe('DayEditor — a typed value on close, on desktop too', () => {
  it('saves a draft the editor unmounts on before the field blurs', async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(
      <DayEditor
        habitId={HABIT_ID}
        date={DATE}
        criteria={[MEDITATE]}
        results={{}}
        isSkipped={false}
        skipReason={null}
        isBeforeStart={false}
        onClose={jest.fn()}
      />,
      { habits: { habits: [HABIT], entries: [], today: DATE } },
    );

    await user.type(screen.getByLabelText('Meditate'), '25');
    view.unmount();

    expect(logDay).toHaveBeenCalledTimes(1);
    expect(logDay).toHaveBeenCalledWith(HABIT_ID, DATE, { meditate: 25 });
  });
});

/** An open editor, and a way to close it as the grid does: by flagging it, not unmounting it. */
function renderOpen(criteria: HabitCriterion[]) {
  const element = (closing: boolean) => (
    <DayEditor
      habitId={HABIT_ID}
      date={DATE}
      criteria={criteria}
      results={{}}
      isSkipped={false}
      skipReason={null}
      isBeforeStart={false}
      onClose={jest.fn()}
      closing={closing}
    />
  );
  const view = renderWithProviders(element(false), {
    habits: { habits: [HABIT], entries: [], today: DATE },
  });
  return {
    close: () => {
      view.rerender(element(true));
    },
    unmount: view.unmount,
  };
}

describe('DayEditor — closing while its container fades out', () => {
  it('saves at the moment it closes, not when the exit animation later unmounts it', async () => {
    const user = userEvent.setup();
    const { close, unmount } = renderOpen([MEDITATE, LIGHT]);

    await user.click(screen.getByRole('button', { name: 'Outside for light' }));
    await user.type(screen.getByLabelText('Meditate'), '25');
    close();

    expect(logDay).toHaveBeenCalledTimes(1);
    expect(logDay).toHaveBeenCalledWith(HABIT_ID, DATE, { light: true, meditate: 25 });

    // Neither the debounce nor the unmount sends it again.
    await new Promise((resolve) => setTimeout(resolve, 300));
    unmount();
    expect(logDay).toHaveBeenCalledTimes(1);
  });
});
