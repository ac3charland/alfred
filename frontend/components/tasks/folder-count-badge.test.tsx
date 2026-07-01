import { render, screen } from '@testing-library/react';

import { FolderCountBadge } from './folder-count-badge';

describe('FolderCountBadge', () => {
  describe('attention tone (amber)', () => {
    it('renders the count with the amber attention tone', () => {
      render(<FolderCountBadge tone="attention" count={3} />);

      const badge = screen.getByText('3');
      expect(badge).toHaveClass('text-accent-amber', 'border-accent-amber/50', 'rounded-full');
    });

    it('labels its meaning as high-priority or due today, not just the number', () => {
      render(<FolderCountBadge tone="attention" count={2} />);

      expect(screen.getByLabelText('2 high-priority or due today')).toBeInTheDocument();
    });
  });

  describe('overdue tone (red)', () => {
    it('renders the count with the red overdue tone', () => {
      render(<FolderCountBadge tone="overdue" count={4} />);

      const badge = screen.getByText('4');
      expect(badge).toHaveClass('text-accent-red', 'border-accent-red/50', 'rounded-full');
    });

    it('labels its meaning as overdue, not just the number', () => {
      render(<FolderCountBadge tone="overdue" count={1} />);

      expect(screen.getByLabelText('1 overdue')).toBeInTheDocument();
    });
  });

  it('stays shrink-0 so a long folder name truncates before it', () => {
    render(<FolderCountBadge tone="attention" count={1} />);

    expect(screen.getByText('1')).toHaveClass('shrink-0');
  });

  it('renders nothing at zero (no "0" chip — clean folders stay clean)', () => {
    const { container } = render(<FolderCountBadge tone="overdue" count={0} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a negative count (defensive)', () => {
    const { container } = render(<FolderCountBadge tone="attention" count={-1} />);

    expect(container).toBeEmptyDOMElement();
  });
});
