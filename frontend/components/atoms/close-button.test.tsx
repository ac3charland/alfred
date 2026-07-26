import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CloseButton } from './close-button';

describe('CloseButton', () => {
  it('text variant defaults its label to "Close"', () => {
    render(<CloseButton variant="text" />);

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('text variant accepts custom children', () => {
    render(<CloseButton variant="text">Dismiss</CloseButton>);

    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('icon variant renders its icon child with an accessible name', () => {
    render(
      <CloseButton variant="icon" aria-label="Dismiss notification">
        <span>x</span>
      </CloseButton>,
    );

    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument();
  });

  it('defaults to type="button"', () => {
    render(<CloseButton variant="text" />);

    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('type', 'button');
  });

  it('shares one muted, teal-focus-ring treatment across both variants', () => {
    const { rerender } = render(<CloseButton variant="text" />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass(
      'text-muted-foreground',
      'hover:text-foreground',
      'focus-visible:ring-accent-teal',
    );

    rerender(
      <CloseButton variant="icon" aria-label="Dismiss">
        <span>x</span>
      </CloseButton>,
    );
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveClass(
      'text-muted-foreground',
      'hover:text-foreground',
      'focus-visible:ring-accent-teal',
    );

    rerender(
      <CloseButton variant="dialog" aria-label="Dismiss">
        <span>x</span>
      </CloseButton>,
    );
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveClass(
      'text-muted-foreground',
      'hover:text-foreground',
      'focus-visible:ring-accent-teal',
    );
  });

  it('dialog variant gives a ≥44px tap target on mobile, back to the dense box at md+ (ALF-138)', () => {
    // A modal's dismiss is the one control a thumb reaches for first, and p-1 around a glyph is
    // roughly 24px — under the 44px the rest of the app's mobile targets use (ALF-98, ALF-86).
    // Enlarge the REAL box (h-11 w-11) and scale the glyph with it so it isn't lost in the
    // target; md: restores today's dense header on pointer devices.
    render(
      <CloseButton variant="dialog" aria-label="Close">
        <span>×</span>
      </CloseButton>,
    );

    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass(
      'h-11',
      'w-11',
      'text-2xl',
      'md:h-auto',
      'md:w-auto',
      'md:p-1',
      'md:text-lg',
    );
  });

  it('forwards onClick', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<CloseButton variant="text" onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
