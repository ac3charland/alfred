import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { RecurrenceRule } from '@/lib/recurrence';

import { RecurrenceChip } from './recurrence-chip';

const WEEKLY: RecurrenceRule = {
  freq: 'weekly',
  interval: 2,
  byweekday: [1, 3],
  end: { type: 'never' },
};

describe('RecurrenceChip', () => {
  it('renders the rule summary as a button', () => {
    render(<RecurrenceChip rule={WEEKLY} />);
    expect(
      screen.getByRole('button', { name: 'Repeats: Every 2 weeks on Mon, Wed' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Every 2 weeks on Mon, Wed')).toBeInTheDocument();
  });

  it('defaults to type="button" so it never submits a form', () => {
    render(<RecurrenceChip rule={WEEKLY} />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('allows overriding the aria-label', () => {
    render(<RecurrenceChip rule={WEEKLY} aria-label="Edit repeat" />);
    expect(screen.getByRole('button', { name: 'Edit repeat' })).toBeInTheDocument();
  });

  it('forwards onClick', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<RecurrenceChip rule={WEEKLY} onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes a stable component name for devtools', () => {
    expect(RecurrenceChip.name).toBe('RecurrenceChip');
  });
});
