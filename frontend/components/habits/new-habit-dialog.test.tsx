import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { NewHabitDialog } from '@/components/habits/new-habit-dialog';
import { renderWithProviders } from '@/lib/test-utils';
import type { Habit } from '@/lib/types';

const SAVED: Habit = {
  id: 'habit-1',
  name: 'Morning routine',
  notes: null,
  criteria: [],
  active_days: [1, 2, 3, 4, 5, 6, 7],
  allowance: 0,
  started_on: '2026-07-28',
  archived_at: null,
  sort_order: null,
  created_at: '2026-07-28T00:00:00Z',
};

function renderDialog() {
  const onCreate = jest.fn().mockResolvedValue(SAVED);
  const onOpenChange = jest.fn();
  renderWithProviders(<NewHabitDialog open onOpenChange={onOpenChange} onCreate={onCreate} />);
  return { onCreate, onOpenChange };
}

/** Walk the kind-first `+` flow: choose a kind, fill its fields, confirm. */
async function addCriterion(
  user: ReturnType<typeof userEvent.setup>,
  kind: string,
  label: string,
  target?: string,
) {
  await user.click(screen.getByRole('button', { name: 'Add a criterion' }));
  await user.click(screen.getByRole('button', { name: new RegExp(kind) }));
  await user.type(screen.getByLabelText('Label'), label);
  if (target !== undefined) {
    const field = screen.getByLabelText(/No later than|At least|At most|Exactly/);
    await user.clear(field);
    await user.type(field, target);
  }
  await user.click(screen.getByRole('button', { name: 'Done' }));
}

describe('NewHabitDialog — the sentence', () => {
  it('reads as one sentence whose every slot is a labelled control', () => {
    renderDialog();

    expect(screen.getByLabelText('Habit name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Days: day' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a criterion' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allowance: no misses a week' })).toBeInTheDocument();
  });

  it('reaches every slot by keyboard, in reading order', async () => {
    const user = userEvent.setup();
    renderDialog();

    // The name field takes focus on open; Tab then walks the sentence left to right.
    expect(screen.getByLabelText('Habit name')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Days: day' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Add a criterion' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Allowance: no misses a week' })).toHaveFocus();
  });

  it('writes the weekday set back into the sentence', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Days: day' }));
    for (const day of ['Saturday', 'Sunday']) {
      await user.click(screen.getByRole('button', { name: day }));
    }
    await user.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: 'Days: weekday' })).toBeInTheDocument();
  });

  it('writes the allowance back into the sentence', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Allowance: no misses a week' }));
    await user.click(screen.getByRole('button', { name: '1 miss a week' }));

    expect(screen.getByRole('button', { name: 'Allowance: 1 miss a week' })).toBeInTheDocument();
  });
});

describe('NewHabitDialog — building a criterion', () => {
  it('teaches what a criterion can be before asking for any fields', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Add a criterion' }));

    expect(screen.getByRole('button', { name: /Yes \/ no/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A time/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A count/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A duration/ })).toBeInTheDocument();
    // No fields yet — the kind decides which ones exist at all.
    expect(screen.queryByLabelText('Label')).not.toBeInTheDocument();
  });

  it('shows only the chosen kind’s fields', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Add a criterion' }));
    await user.click(screen.getByRole('button', { name: /Yes \/ no/ }));

    expect(screen.getByLabelText('Label')).toBeInTheDocument();
    expect(screen.queryByLabelText(/No later than/)).not.toBeInTheDocument();
  });

  it('adds a boolean criterion to the sentence', async () => {
    const user = userEvent.setup();
    renderDialog();

    await addCriterion(user, 'Yes / no', 'get outside for light');

    expect(
      screen.getByRole('button', { name: 'Edit criterion: get outside for light' }),
    ).toBeInTheDocument();
  });

  it('adds a time criterion carrying its target', async () => {
    const user = userEvent.setup();
    renderDialog();

    await addCriterion(user, 'A time', 'be up by', '06:15');

    expect(
      screen.getByRole('button', { name: 'Edit criterion: be up by 06:15' }),
    ).toBeInTheDocument();
  });

  it('adds a duration criterion whose target says the minutes it is counted in', async () => {
    const user = userEvent.setup();
    renderDialog();

    await addCriterion(user, 'A duration', 'meditate', '20');

    // The number is stored as bare minutes, so the sentence is where that unit gets said.
    expect(
      screen.getByRole('button', { name: 'Edit criterion: meditate 20 min' }),
    ).toBeInTheDocument();
  });

  it('says the unit beside the duration target being typed, not only after saving', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Add a criterion' }));
    await user.click(screen.getByRole('button', { name: /A duration/ }));

    expect(screen.getByLabelText('At least')).toHaveAccessibleDescription('min');
  });

  it('leaves a count target unitless — its unit is whatever the label says', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Add a criterion' }));
    await user.click(screen.getByRole('button', { name: /A count/ }));

    expect(screen.getByLabelText('At least')).toHaveAccessibleDescription('');
  });

  it('reopens the same editor prefilled when an existing chip is clicked', async () => {
    const user = userEvent.setup();
    renderDialog();
    await addCriterion(user, 'A time', 'be up by', '06:15');

    await user.click(screen.getByRole('button', { name: 'Edit criterion: be up by 06:15' }));

    expect(screen.getByLabelText('Label')).toHaveValue('be up by');
    expect(screen.getByLabelText('No later than')).toHaveValue('06:15');
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('takes a criterion back out of the sentence', async () => {
    const user = userEvent.setup();
    renderDialog();
    await addCriterion(user, 'Yes / no', 'get outside');

    await user.click(screen.getByRole('button', { name: 'Edit criterion: get outside' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(
      screen.queryByRole('button', { name: 'Edit criterion: get outside' }),
    ).not.toBeInTheDocument();
  });
});

describe('NewHabitDialog — submitting', () => {
  it('stays disabled until the habit has a name and at least one criterion', async () => {
    const user = userEvent.setup();
    renderDialog();
    const create = screen.getByRole('button', { name: 'Create habit' });

    expect(create).toBeDisabled();

    await user.type(screen.getByLabelText('Habit name'), 'Morning routine');
    expect(create).toBeDisabled();

    await addCriterion(user, 'Yes / no', 'get outside');
    expect(create).toBeEnabled();
  });

  it('sends the sentence as the create payload, with generated criterion keys', async () => {
    const user = userEvent.setup();
    const { onCreate, onOpenChange } = renderDialog();

    await user.type(screen.getByLabelText('Habit name'), '  Morning routine  ');
    await addCriterion(user, 'A time', 'be up by', '06:15');
    await addCriterion(user, 'Yes / no', 'get outside for light');
    await user.click(screen.getByRole('button', { name: 'Allowance: no misses a week' }));
    await user.click(screen.getByRole('button', { name: '1 miss a week' }));
    await user.click(screen.getByRole('button', { name: 'Create habit' }));

    expect(onCreate).toHaveBeenCalledWith({
      name: 'Morning routine',
      criteria: [
        { key: 'be_up_by', label: 'be up by', kind: 'time', target: 375, comparator: 'lte' },
        { key: 'get_outside_for_light', label: 'get outside for light', kind: 'boolean' },
      ],
      active_days: [1, 2, 3, 4, 5, 6, 7],
      allowance: 1,
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('de-duplicates a criterion key against the ones already in the sentence', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog();

    await user.type(screen.getByLabelText('Habit name'), 'Water');
    await addCriterion(user, 'Yes / no', 'drink');
    await addCriterion(user, 'Yes / no', 'drink');
    await user.click(screen.getByRole('button', { name: 'Create habit' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        criteria: [
          { key: 'drink', label: 'drink', kind: 'boolean' },
          { key: 'drink_2', label: 'drink', kind: 'boolean' },
        ],
      }),
    );
  });

  it('surfaces a failed create and leaves the dialog open to retry', async () => {
    const user = userEvent.setup();
    const onCreate = jest.fn().mockRejectedValue(new Error('nope'));
    const onOpenChange = jest.fn();
    renderWithProviders(<NewHabitDialog open onOpenChange={onOpenChange} onCreate={onCreate} />);

    await user.type(screen.getByLabelText('Habit name'), 'Morning routine');
    await addCriterion(user, 'Yes / no', 'get outside');
    await user.click(screen.getByRole('button', { name: 'Create habit' }));

    expect(await screen.findByText('Could not create the habit. Try again.')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
