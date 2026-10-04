import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { pinClock, setClockNow } from '@/lib/pin-clock';

import { DueDateChip } from './due-date-chip';

pinClock('2026-07-28T12:00:00.000Z');

/** Today's local YYYY-MM-DD — the date the chip should treat as the "due today" band. */
function todayLocalYMD(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('DueDateChip', () => {
  // ---------------------------------------------------------------------------
  // Compact (task-row badge)
  // ---------------------------------------------------------------------------

  describe('compact (row badge)', () => {
    it('renders the formatted due date as a button, aria-label carrying the value', () => {
      render(<DueDateChip dueDate="2999-12-31" />);

      const chip = screen.getByRole('button', { name: 'Due date: 2999-12-31' });
      expect(chip).toHaveAttribute('type', 'button');
      expect(chip).toHaveTextContent('Dec 31');
    });

    it('uses the blue treatment for a future date', () => {
      render(<DueDateChip dueDate="2999-12-31" />);

      const chip = screen.getByRole('button', { name: 'Due date: 2999-12-31' });
      expect(chip).toHaveClass('rounded-full', 'border', 'text-accent-blue');
      expect(chip).not.toHaveClass('text-accent-amber', 'text-accent-red');
    });

    it('uses the amber (yellow) treatment for a date due today', () => {
      const today = todayLocalYMD();
      render(<DueDateChip dueDate={today} />);

      const chip = screen.getByRole('button', { name: `Due date: ${today}` });
      expect(chip).toHaveClass('text-accent-amber', 'border-accent-amber/50');
      expect(chip).not.toHaveClass('text-accent-blue', 'text-accent-red');
    });

    it('uses the red treatment for an overdue date', () => {
      render(<DueDateChip dueDate="2000-01-01" />);

      const chip = screen.getByRole('button', { name: 'Due date: 2000-01-01' });
      expect(chip).toHaveClass('text-accent-red', 'border-accent-red/50');
      expect(chip).not.toHaveClass('text-accent-blue', 'text-accent-amber');
    });

    it('allows overriding the aria-label', () => {
      render(<DueDateChip dueDate="2999-12-31" aria-label="Change due date" />);

      expect(screen.getByRole('button', { name: 'Change due date' })).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Comfortable (detail-panel chip) — same urgency bands, larger geometry
  // ---------------------------------------------------------------------------

  describe('comfortable (detail chip)', () => {
    it('prompts to set a date when unset, with a neutral tone', () => {
      render(
        <DueDateChip dueDate={null} size="comfortable" onSelect={jest.fn()} onClear={jest.fn()} />,
      );

      const chip = screen.getByRole('button', { name: 'Due date' });
      expect(chip).toHaveTextContent(/set a due date/i);
      expect(chip).toHaveClass('rounded-[9px]', 'text-[#8A96A8]');
    });

    it('colours by urgency band, not a fixed blue', () => {
      const { rerender } = render(
        <DueDateChip
          dueDate="2999-12-31"
          size="comfortable"
          onSelect={jest.fn()}
          onClear={jest.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: 'Due date' })).toHaveClass('text-accent-blue');

      rerender(
        <DueDateChip
          dueDate={todayLocalYMD()}
          size="comfortable"
          onSelect={jest.fn()}
          onClear={jest.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: 'Due date' })).toHaveClass('text-accent-amber');

      rerender(
        <DueDateChip
          dueDate="2000-01-01"
          size="comfortable"
          onSelect={jest.fn()}
          onClear={jest.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: 'Due date' })).toHaveClass('text-accent-red');
    });
  });

  // ---------------------------------------------------------------------------
  // Clickable in both sizes — opens the calendar, auto-saves the pick
  // ---------------------------------------------------------------------------

  describe('editing (onSelect / onClear given)', () => {
    it('opens the calendar and applies a picked day (compact)', async () => {
      const onSelect = jest.fn();
      const user = userEvent.setup();
      render(<DueDateChip dueDate="2025-07-02" onSelect={onSelect} onClear={jest.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Due date: 2025-07-02' }));
      await user.click(await screen.findByRole('button', { name: 'July 10, 2025' }));

      expect(onSelect).toHaveBeenCalledWith('2025-07-10');
    });

    it('opens the calendar and applies a picked day (comfortable)', async () => {
      const onSelect = jest.fn();
      const user = userEvent.setup();
      render(
        <DueDateChip
          dueDate="2025-07-02"
          size="comfortable"
          onSelect={onSelect}
          onClear={jest.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Due date' }));
      await user.click(await screen.findByRole('button', { name: 'July 10, 2025' }));

      expect(onSelect).toHaveBeenCalledWith('2025-07-10');
    });

    it('clears the date from the calendar footer', async () => {
      const onClear = jest.fn();
      const user = userEvent.setup();
      render(<DueDateChip dueDate="2025-07-02" onSelect={jest.fn()} onClear={onClear} />);

      await user.click(screen.getByRole('button', { name: 'Due date: 2025-07-02' }));
      await user.click(await screen.findByRole('button', { name: 'Clear' }));

      expect(onClear).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Timed — the label reads date + time, and the band flips at the minute
  // ---------------------------------------------------------------------------

  describe('timed', () => {
    beforeEach(() => {
      // Only the interval timer is faked: the pinned clock still answers "what time is it".
      jest.useFakeTimers({ doNotFake: ['Date'] });
      setClockNow(new Date(2026, 9, 3, 14, 59, 30).toISOString());
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('reads date + time, and announces both', () => {
      render(<DueDateChip dueDate="2026-10-04" dueTime="09:30" />);

      const chip = screen.getByRole('button', { name: 'Due date: 2026-10-04 09:30' });
      expect(chip).toHaveTextContent('Tomorrow 9:30 AM');
    });

    it('reads exactly as before when untimed', () => {
      render(<DueDateChip dueDate="2026-10-04" dueTime={null} />);
      expect(screen.getByRole('button', { name: 'Due date: 2026-10-04' })).toHaveTextContent(
        /^Tomorrow$/,
      );
    });

    it('is amber before its minute and turns red at it, without a reload', () => {
      render(<DueDateChip dueDate="2026-10-03" dueTime="15:00" />);

      const chip = screen.getByRole('button', { name: /^Due date/ });
      expect(chip).toHaveTextContent('Today 3 PM');
      expect(chip).toHaveClass('text-accent-amber');

      act(() => {
        setClockNow(new Date(2026, 9, 3, 15, 0, 1).toISOString());
        jest.advanceTimersByTime(1000);
      });

      expect(screen.getByRole('button', { name: /^Due date/ })).toHaveClass('text-accent-red');
    });

    it('flips the inert (select-mode) chip too', () => {
      render(<DueDateChip dueDate="2026-10-03" dueTime="14:00" inert />);
      expect(screen.getByLabelText(/^Due date/)).toHaveClass('text-accent-red');
    });

    it('stays blue on a later day whatever the time', () => {
      render(<DueDateChip dueDate="2026-10-04" dueTime="00:00" />);
      expect(screen.getByRole('button', { name: /^Due date/ })).toHaveClass('text-accent-blue');
    });
  });

  describe('the picker', () => {
    it('shows the time row, and a time commit saves but leaves the picker open', async () => {
      const onSetTime = jest.fn();
      const user = userEvent.setup();
      render(
        <DueDateChip
          dueDate="2025-07-02"
          onSelect={jest.fn()}
          onClear={jest.fn()}
          onSetTime={onSetTime}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Due date: 2025-07-02' }));
      await user.click(await screen.findByRole('button', { name: 'Add time' }));
      await user.type(screen.getByLabelText('Due time'), '15:00{Enter}');

      expect(onSetTime).toHaveBeenCalledWith('15:00');
      expect(screen.getByRole('button', { name: 'July 10, 2025' })).toBeInTheDocument();
    });

    it('closes on a day pick', async () => {
      const onSelect = jest.fn();
      const user = userEvent.setup();
      render(
        <DueDateChip
          dueDate="2025-07-02"
          dueTime="15:00"
          onSelect={onSelect}
          onClear={jest.fn()}
          onSetTime={jest.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: /^Due date/ }));
      await user.click(await screen.findByRole('button', { name: 'July 10, 2025' }));

      expect(onSelect).toHaveBeenCalledWith('2025-07-10');
      expect(screen.queryByRole('button', { name: 'July 10, 2025' })).not.toBeInTheDocument();
    });

    it('stays open when the committed time turns an untimed chip timed', async () => {
      const user = userEvent.setup();
      function Harness() {
        const [time, setTime] = React.useState<string | null>(null);
        return (
          <DueDateChip
            dueDate="2025-07-02"
            dueTime={time}
            onSelect={jest.fn()}
            onClear={jest.fn()}
            onSetTime={setTime}
          />
        );
      }
      render(<Harness />);

      await user.click(screen.getByRole('button', { name: /^Due date/ }));
      await user.click(await screen.findByRole('button', { name: 'Add time' }));
      await user.type(screen.getByLabelText('Due time'), '15:00{Enter}');

      expect(screen.getByRole('button', { name: /^Due date/ })).toHaveTextContent('3 PM');
      expect(screen.getByLabelText('Due time')).toHaveValue('15:00');
    });
  });

  // ---------------------------------------------------------------------------
  // Display-only — no handlers, no calendar (e.g. the Priority view)
  // ---------------------------------------------------------------------------

  it('is display-only (no calendar) when no handlers are given', async () => {
    const user = userEvent.setup();
    render(<DueDateChip dueDate="2025-07-02" />);

    await user.click(screen.getByRole('button', { name: 'Due date: 2025-07-02' }));

    // No popover trigger wiring → clicking reveals no calendar day cells.
    expect(screen.queryByRole('button', { name: 'July 10, 2025' })).not.toBeInTheDocument();
  });

  it('exposes a stable component name for devtools', () => {
    expect(DueDateChip.name).toBe('DueDateChip');
  });
});
