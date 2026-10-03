import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { pinClock } from '@/lib/pin-clock';

import { DueDatePicker } from './due-date-picker';

pinClock('2026-07-28T12:00:00.000Z');

function renderPicker(overrides: Partial<React.ComponentProps<typeof DueDatePicker>> = {}) {
  const handlers = { onSelect: jest.fn(), onClear: jest.fn(), onSetTime: jest.fn() };
  render(<DueDatePicker dueDate="2026-07-30" dueTime={null} {...handlers} {...overrides} />);
  return handlers;
}

describe('DueDatePicker', () => {
  describe('before a time is set', () => {
    it('offers "Add time" under the grid, not a field', () => {
      renderPicker();
      expect(screen.getByRole('button', { name: 'Add time' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Due time')).not.toBeInTheDocument();
    });

    it('opens a focused time field, and saves a typed time on blur', async () => {
      const user = userEvent.setup();
      const { onSetTime, onSelect } = renderPicker();

      await user.click(screen.getByRole('button', { name: 'Add time' }));
      const field = screen.getByLabelText('Due time');
      expect(field).toHaveFocus();
      expect(field).toHaveAttribute('type', 'time');

      await user.type(field, '15:00');
      expect(onSetTime).not.toHaveBeenCalled(); // not on every keystroke
      await user.tab();

      expect(onSetTime).toHaveBeenCalledTimes(1);
      expect(onSetTime).toHaveBeenCalledWith('15:00');
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('saves on Enter', async () => {
      const user = userEvent.setup();
      const { onSetTime } = renderPicker();

      await user.click(screen.getByRole('button', { name: 'Add time' }));
      await user.type(screen.getByLabelText('Due time'), '09:30{Enter}');

      expect(onSetTime).toHaveBeenCalledWith('09:30');
    });

    it('reverts on Escape without saving', async () => {
      const user = userEvent.setup();
      const { onSetTime } = renderPicker();

      await user.click(screen.getByRole('button', { name: 'Add time' }));
      await user.type(screen.getByLabelText('Due time'), '15:00{Escape}');
      await user.tab();

      expect(onSetTime).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Add time' })).toBeInTheDocument();
    });

    it('goes back to "Add time" when left empty, saving nothing', async () => {
      const user = userEvent.setup();
      const { onSetTime } = renderPicker();

      await user.click(screen.getByRole('button', { name: 'Add time' }));
      await user.tab();

      expect(onSetTime).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Add time' })).toBeInTheDocument();
    });
  });

  describe('once a time is set', () => {
    it('shows the time in the field, with a × that clears just the time', async () => {
      const user = userEvent.setup();
      const { onSetTime, onClear } = renderPicker({ dueTime: '15:00' });

      expect(screen.getByLabelText('Due time')).toHaveValue('15:00');
      await user.click(screen.getByRole('button', { name: 'Clear time' }));

      expect(onSetTime).toHaveBeenCalledWith(null);
      expect(onClear).not.toHaveBeenCalled();
    });

    it('does not save an unchanged time', async () => {
      const user = userEvent.setup();
      const { onSetTime } = renderPicker({ dueTime: '15:00' });

      await user.click(screen.getByLabelText('Due time'));
      await user.tab();

      expect(onSetTime).not.toHaveBeenCalled();
    });

    it('Escape puts back the stored time', async () => {
      const user = userEvent.setup();
      const { onSetTime } = renderPicker({ dueTime: '15:00' });

      const field = screen.getByLabelText('Due time');
      await user.clear(field);
      await user.type(field, '18:45{Escape}');

      expect(field).toHaveValue('15:00');
      expect(onSetTime).not.toHaveBeenCalled();
    });
  });

  it('commits again after an Escape once the field is edited further', async () => {
    const user = userEvent.setup();
    const { onSetTime } = renderPicker({ dueTime: '15:00' });

    const field = screen.getByLabelText('Due time');
    await user.clear(field);
    await user.type(field, '18:45{Escape}');
    await user.clear(field);
    await user.type(field, '07:15');
    await user.tab();

    expect(onSetTime).toHaveBeenCalledWith('07:15');
  });

  describe('dismissed while the field holds a typed time', () => {
    it('saves the draft on unmount — an outside click closes the popover without a blur', async () => {
      const user = userEvent.setup();
      const handlers = { onSelect: jest.fn(), onClear: jest.fn(), onSetTime: jest.fn() };
      const { unmount } = render(
        <DueDatePicker dueDate="2026-07-30" dueTime={null} {...handlers} />,
      );

      await user.click(screen.getByRole('button', { name: 'Add time' }));
      await user.type(screen.getByLabelText('Due time'), '15:00');
      unmount();

      expect(handlers.onSetTime).toHaveBeenCalledTimes(1);
      expect(handlers.onSetTime).toHaveBeenCalledWith('15:00');
    });

    it('saves nothing on unmount after an Escape', async () => {
      const user = userEvent.setup();
      const handlers = { onSelect: jest.fn(), onClear: jest.fn(), onSetTime: jest.fn() };
      const { unmount } = render(
        <DueDatePicker dueDate="2026-07-30" dueTime="09:00" {...handlers} />,
      );

      const field = screen.getByLabelText('Due time');
      await user.clear(field);
      await user.type(field, '15:00{Escape}');
      unmount();

      expect(handlers.onSetTime).not.toHaveBeenCalled();
    });

    it('does not save twice when a blur commit is followed by the unmount', async () => {
      const user = userEvent.setup();
      const handlers = { onSelect: jest.fn(), onClear: jest.fn(), onSetTime: jest.fn() };
      const { unmount } = render(
        <DueDatePicker dueDate="2026-07-30" dueTime={null} {...handlers} />,
      );

      await user.click(screen.getByRole('button', { name: 'Add time' }));
      await user.type(screen.getByLabelText('Due time'), '15:00');
      await user.tab();
      unmount();

      expect(handlers.onSetTime).toHaveBeenCalledTimes(1);
    });
  });

  it('applies a day pick and the footer buttons through the grid handlers', async () => {
    const user = userEvent.setup();
    const { onSelect, onClear } = renderPicker({ dueTime: '15:00' });

    await user.click(screen.getByRole('button', { name: 'July 31, 2026' }));
    expect(onSelect).toHaveBeenCalledWith('2026-07-31');

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('marks the selected day even when the date arrives as a timestamp', () => {
    renderPicker({ dueDate: '2026-07-30T00:00:00+00:00' });
    expect(screen.getByRole('button', { name: 'July 30, 2026' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
