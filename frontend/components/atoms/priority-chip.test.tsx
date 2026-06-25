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

  it('renders nothing when the priority is not a known level (missing column → undefined)', () => {
    // Backstop for the production crash: a row can reach the chip with `priority` undefined (a
    // task_items row whose column the read layer dropped). It must render nothing, not destructure
    // an absent option and white-screen the page.
    const { container } = render(<PriorityChip priority={undefined as unknown as 'high'} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('forwards onClick', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<PriorityChip priority="high" onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
