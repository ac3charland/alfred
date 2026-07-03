import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { RecurrenceRule } from '@/lib/recurrence';

import { PriorityChip, RepeatChip } from './detail-chips';

describe('detail chips (ALF-67)', () => {
  describe('PriorityChip', () => {
    it('labels the chip and check-marks the active level in the list', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();
      render(<PriorityChip priority="medium" onChange={onChange} />);

      expect(screen.getByRole('button', { name: 'Priority' })).toHaveTextContent('Medium');
      await user.click(screen.getByRole('button', { name: 'Priority' }));
      await user.click(await screen.findByRole('button', { name: /high/i }));

      expect(onChange).toHaveBeenCalledWith('high');
    });

    it('clears the level via "No priority"', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();
      render(<PriorityChip priority="high" onChange={onChange} />);

      await user.click(screen.getByRole('button', { name: 'Priority' }));
      await user.click(await screen.findByRole('button', { name: /no priority/i }));

      expect(onChange).toHaveBeenCalledWith(null);
    });
  });

  describe('RepeatChip', () => {
    const dailyRule: RecurrenceRule = { freq: 'daily', interval: 1, end: { type: 'never' } };

    it('shows "Never" when not repeating and the summary when it does', () => {
      const { rerender } = render(<RepeatChip rule={null} dueDate={null} onChange={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'Repeat' })).toHaveTextContent('Never');
      rerender(<RepeatChip rule={dailyRule} dueDate="2025-07-02" onChange={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'Repeat' })).toHaveTextContent(/daily/i);
    });

    it('applies a preset, anchored to the due date', async () => {
      const onChange = jest.fn();
      const user = userEvent.setup();
      // A known anchor (the due date) makes the produced rule deterministic.
      render(<RepeatChip rule={null} dueDate="2025-07-02" onChange={onChange} />);

      await user.click(screen.getByRole('button', { name: 'Repeat' }));
      await user.click(await screen.findByRole('button', { name: 'Daily' }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ freq: 'daily' }),
        '2025-07-02',
      );
    });

    it('opens the full custom editor from "Custom…"', async () => {
      const user = userEvent.setup();
      render(<RepeatChip rule={null} dueDate="2025-07-02" onChange={jest.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Repeat' }));
      await user.click(await screen.findByRole('button', { name: /custom/i }));

      // The RecurrenceEditor dialog opens (it carries a "Repeat every" control).
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
  });
});
