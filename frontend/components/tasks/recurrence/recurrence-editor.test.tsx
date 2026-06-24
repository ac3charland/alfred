import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { RecurrenceRule } from '@/lib/recurrence';

import { RecurrenceEditor } from './recurrence-editor';

// 2026-06-15 is a Monday and the 3rd Monday of June 2026 — drives the positional defaults.
const ANCHOR = '2026-06-15';

function renderEditor(props: Partial<React.ComponentProps<typeof RecurrenceEditor>> = {}) {
  const onSave = props.onSave ?? jest.fn();
  const onOpenChange = props.onOpenChange ?? jest.fn();
  render(
    <RecurrenceEditor
      open
      onOpenChange={onOpenChange}
      initialRule={props.initialRule ?? null}
      anchorDate={props.anchorDate ?? ANCHOR}
      onSave={onSave}
    />,
  );
  return { onSave, onOpenChange };
}

describe('RecurrenceEditor', () => {
  it('saves a daily rule by default', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSave).toHaveBeenCalledWith({ freq: 'daily', interval: 1, end: { type: 'never' } });
  });

  it('captures the Every N interval', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();
    const interval = screen.getByLabelText(/interval in days/i);
    await user.clear(interval);
    await user.type(interval, '3');
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSave).toHaveBeenCalledWith({ freq: 'daily', interval: 3, end: { type: 'never' } });
  });

  it('builds a weekly rule from the day toggles (anchor day pre-selected)', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();
    await user.selectOptions(screen.getByLabelText('Frequency'), 'weekly');
    // The anchor (Monday) is pre-selected; add Wednesday.
    await user.click(screen.getByRole('button', { name: 'Wednesday', pressed: false }));
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSave).toHaveBeenCalledWith({
      freq: 'weekly',
      interval: 1,
      byweekday: [1, 3],
      end: { type: 'never' },
    });
  });

  it('disables OK for a weekly rule with no days selected', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.selectOptions(screen.getByLabelText('Frequency'), 'weekly');
    // Deselect the pre-selected anchor day (Monday).
    await user.click(screen.getByRole('button', { name: 'Monday', pressed: true }));
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });

  it('builds a monthly day-of-month rule', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();
    await user.selectOptions(screen.getByLabelText('Frequency'), 'monthly');
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSave).toHaveBeenCalledWith({
      freq: 'monthly',
      interval: 1,
      monthly: { kind: 'day_of_month' },
      end: { type: 'never' },
    });
  });

  it('builds a monthly positional rule', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();
    await user.selectOptions(screen.getByLabelText('Frequency'), 'monthly');
    await user.selectOptions(screen.getByLabelText('Which occurrence'), '-1');
    await user.selectOptions(screen.getByLabelText('Weekday'), '5');
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSave).toHaveBeenCalledWith({
      freq: 'monthly',
      interval: 1,
      monthly: { kind: 'positional', setpos: -1, weekday: 5 },
      end: { type: 'never' },
    });
  });

  it('captures an on_date end condition', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();
    await user.selectOptions(screen.getByLabelText('End repeat'), 'on_date');
    const dateInput = screen.getByLabelText('End date');
    await user.clear(dateInput);
    await user.type(dateInput, '2026-08-01');
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSave).toHaveBeenCalledWith({
      freq: 'daily',
      interval: 1,
      end: { type: 'on_date', until: '2026-08-01' },
    });
  });

  it('captures an after-N end condition', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();
    await user.selectOptions(screen.getByLabelText('End repeat'), 'after');
    const count = screen.getByLabelText('Occurrence count');
    await user.clear(count);
    await user.type(count, '5');
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSave).toHaveBeenCalledWith({
      freq: 'daily',
      interval: 1,
      end: { type: 'after', count: 5 },
    });
  });

  it('pre-fills from an existing rule', async () => {
    const initialRule: RecurrenceRule = {
      freq: 'weekly',
      interval: 2,
      byweekday: [1, 5],
      end: { type: 'never' },
    };
    const user = userEvent.setup();
    const { onSave } = renderEditor({ initialRule });
    // Frequency reflects the rule; OK without changes round-trips it.
    expect(screen.getByLabelText('Frequency')).toHaveValue('weekly');
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSave).toHaveBeenCalledWith(initialRule);
  });

  it('cancels without saving', async () => {
    const user = userEvent.setup();
    const { onSave, onOpenChange } = renderEditor();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
