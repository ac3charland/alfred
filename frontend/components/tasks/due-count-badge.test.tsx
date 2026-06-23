import { render, screen } from '@testing-library/react';

import { DueCountBadge } from './due-count-badge';

describe('DueCountBadge', () => {
  it('renders the count with the amber overdue tone', () => {
    render(<DueCountBadge count={3} />);

    const badge = screen.getByText('3');
    expect(badge).toHaveClass('text-accent-amber', 'border-accent-amber/50', 'rounded-full');
  });

  it('exposes an accessible label naming its meaning, not just the number', () => {
    render(<DueCountBadge count={2} />);

    expect(screen.getByLabelText('2 due today or overdue')).toBeInTheDocument();
  });

  it('renders nothing at zero (no "0" chip — clean folders stay clean)', () => {
    const { container } = render(<DueCountBadge count={0} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a negative count (defensive)', () => {
    const { container } = render(<DueCountBadge count={-1} />);

    expect(container).toBeEmptyDOMElement();
  });
});
