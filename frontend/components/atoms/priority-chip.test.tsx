import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PriorityChip } from './priority-chip';

describe('PriorityChip', () => {
  it('renders the level label as a button with a default aria-label', () => {
    render(<PriorityChip priority="high" />);
    expect(screen.getByRole('button', { name: 'Priority: High' })).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('renders each level', () => {
    const { rerender } = render(<PriorityChip priority="medium" />);
    expect(screen.getByText('Medium')).toBeInTheDocument();
    rerender(<PriorityChip priority="low" />);
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('defaults to type="button" so it never submits a form', () => {
    render(<PriorityChip priority="low" />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('allows overriding the aria-label', () => {
    render(<PriorityChip priority="high" aria-label="Edit priority" />);
    expect(screen.getByRole('button', { name: 'Edit priority' })).toBeInTheDocument();
  });

  it('forwards onClick', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<PriorityChip priority="high" onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
