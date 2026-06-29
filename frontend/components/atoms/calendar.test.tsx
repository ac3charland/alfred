import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { todayISODate } from '@/lib/date-utils';

import { Calendar } from './calendar';

describe('Calendar', () => {
  it('renders the seven weekday headers', () => {
    render(<Calendar selected="2025-07-02" onSelect={jest.fn()} onClear={jest.fn()} />);
    // S M T W T F S — the two S's and two T's mean 7 header cells total.
    expect(screen.getByText('July 2025')).toBeInTheDocument();
  });

  it('opens on the selected date’s month', () => {
    render(<Calendar selected="2025-07-02" onSelect={jest.fn()} onClear={jest.fn()} />);
    expect(screen.getByText('July 2025')).toBeInTheDocument();
  });

  it('marks the selected day as pressed', () => {
    render(<Calendar selected="2025-07-02" onSelect={jest.fn()} onClear={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'July 2, 2025' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('calls onSelect with the ISO date when a day is clicked', async () => {
    const onSelect = jest.fn();
    const user = userEvent.setup();
    render(<Calendar selected="2025-07-02" onSelect={onSelect} onClear={jest.fn()} />);

    await user.click(screen.getByRole('button', { name: 'July 15, 2025' }));

    expect(onSelect).toHaveBeenCalledWith('2025-07-15');
  });

  it('navigates to the next and previous month', async () => {
    const user = userEvent.setup();
    render(<Calendar selected="2025-07-02" onSelect={jest.fn()} onClear={jest.fn()} />);

    await user.click(screen.getByRole('button', { name: /next month/i }));
    expect(screen.getByText('August 2025')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /previous month/i }));
    await user.click(screen.getByRole('button', { name: /previous month/i }));
    expect(screen.getByText('June 2025')).toBeInTheDocument();
  });

  it('Clear calls onClear', async () => {
    const onClear = jest.fn();
    const user = userEvent.setup();
    render(<Calendar selected="2025-07-02" onSelect={jest.fn()} onClear={onClear} />);

    await user.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('Today selects today’s date', async () => {
    const onSelect = jest.fn();
    const user = userEvent.setup();
    render(<Calendar selected={null} onSelect={onSelect} onClear={jest.fn()} />);

    await user.click(screen.getByRole('button', { name: /^today$/i }));

    expect(onSelect).toHaveBeenCalledWith(todayISODate());
  });

  it('falls back to today’s month when nothing is selected', () => {
    render(<Calendar selected={null} onSelect={jest.fn()} onClear={jest.fn()} />);
    const now = new Date();
    const monthName = now.toLocaleString('en-US', { month: 'long' });
    expect(screen.getByText(`${monthName} ${String(now.getFullYear())}`)).toBeInTheDocument();
  });
});
