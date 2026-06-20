import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ClickableCard } from './clickable-card';

describe('ClickableCard', () => {
  it('renders freeform children with an accessible name', () => {
    render(
      <ClickableCard aria-label="Open ALF-1 Title">
        <span>ALF-1</span>
        <span>Title</span>
      </ClickableCard>,
    );

    expect(screen.getByRole('button', { name: 'Open ALF-1 Title' })).toBeInTheDocument();
  });

  it('defaults to type="button"', () => {
    render(<ClickableCard aria-label="Open">content</ClickableCard>);

    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('type', 'button');
  });

  it('owns only the interaction layout (full-width block, outline reset) — no chrome', () => {
    render(<ClickableCard aria-label="Open">content</ClickableCard>);

    const button = screen.getByRole('button', { name: 'Open' });
    expect(button).toHaveClass('block', 'w-full', 'text-left', 'focus:outline-none');
    // No visual chrome baked in — the parent owns padding / focus ring.
    expect(button.className).toBe('block w-full text-left focus:outline-none');
  });

  it('merges parent-supplied layout className (e.g. padding)', () => {
    render(
      <ClickableCard aria-label="Open" className="px-3 py-2">
        content
      </ClickableCard>,
    );

    expect(screen.getByRole('button', { name: 'Open' })).toHaveClass('px-3', 'py-2');
  });

  it('forwards arbitrary props (data attributes) and onClick', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(
      <ClickableCard aria-label="Open" data-factory-state="blocked" onClick={onClick}>
        content
      </ClickableCard>,
    );

    const button = screen.getByRole('button', { name: 'Open' });
    expect(button).toHaveAttribute('data-factory-state', 'blocked');
    await user.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
