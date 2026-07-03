import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DueDateChip } from './due-date-chip';

/** Today's local YYYY-MM-DD — the date the chip should treat as the "due today" band. */
function todayLocalYMD(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('DueDateChip', () => {
  it('renders the formatted due date as a button', () => {
    render(<DueDateChip dueDate="2999-12-31" />);

    // Default accessible name is "Due date: <iso>".
    expect(screen.getByRole('button', { name: 'Due date: 2999-12-31' })).toBeInTheDocument();
  });

  it('defaults to type="button"', () => {
    render(<DueDateChip dueDate="2999-12-31" />);

    expect(screen.getByRole('button', { name: 'Due date: 2999-12-31' })).toHaveAttribute(
      'type',
      'button',
    );
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

  it('forwards onClick', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<DueDateChip dueDate="2999-12-31" onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Due date: 2999-12-31' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes a stable component name for devtools', () => {
    expect(DueDateChip.name).toBe('DueDateChip');
  });
});
