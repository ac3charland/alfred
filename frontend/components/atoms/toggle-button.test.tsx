import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ToggleButton } from './toggle-button';

describe('ToggleButton', () => {
  it('renders a button with its children', () => {
    render(
      <ToggleButton pressed={false} onToggle={() => {}}>
        Show archived
      </ToggleButton>,
    );

    expect(screen.getByRole('button', { name: 'Show archived' })).toBeInTheDocument();
  });

  it('reflects the pressed state via aria-pressed', () => {
    const { rerender } = render(
      <ToggleButton pressed={false} onToggle={() => {}}>
        Show archived
      </ToggleButton>,
    );
    expect(screen.getByRole('button', { name: 'Show archived' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    rerender(
      <ToggleButton pressed onToggle={() => {}}>
        Show archived
      </ToggleButton>,
    );
    expect(screen.getByRole('button', { name: 'Show archived' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('applies the pressed accent treatment when pressed', () => {
    render(
      <ToggleButton pressed onToggle={() => {}}>
        Show archived
      </ToggleButton>,
    );

    expect(screen.getByRole('button', { name: 'Show archived' })).toHaveClass(
      'border-accent-teal/60',
      'bg-accent-teal/10',
      'text-accent-teal',
    );
  });

  it('merges a caller className over its own layout classes', () => {
    render(
      <ToggleButton pressed={false} onToggle={() => {}} className="h-8">
        Show archived
      </ToggleButton>,
    );

    expect(screen.getByRole('button', { name: 'Show archived' })).toHaveClass('h-8');
  });

  it('passes a title through to the button', () => {
    render(
      <ToggleButton pressed={false} onToggle={() => {}} title="Explains what this does">
        Show archived
      </ToggleButton>,
    );

    expect(screen.getByRole('button', { name: 'Show archived' })).toHaveAttribute(
      'title',
      'Explains what this does',
    );
  });

  it('has no title when none is given', () => {
    render(
      <ToggleButton pressed={false} onToggle={() => {}}>
        Show archived
      </ToggleButton>,
    );

    expect(screen.getByRole('button', { name: 'Show archived' })).not.toHaveAttribute('title');
  });

  it('calls onToggle when clicked', async () => {
    const onToggle = jest.fn();
    const user = userEvent.setup();
    render(
      <ToggleButton pressed={false} onToggle={onToggle}>
        Show archived
      </ToggleButton>,
    );

    await user.click(screen.getByRole('button', { name: 'Show archived' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('lights in the tone it is given, and stays neutral while unpressed', () => {
    const { rerender } = render(
      <ToggleButton pressed tone="affirm" onToggle={() => {}}>
        Yes
      </ToggleButton>,
    );
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveClass(
      'border-accent-green',
      'text-accent-green',
    );

    rerender(
      <ToggleButton pressed tone="deny" onToggle={() => {}}>
        Yes
      </ToggleButton>,
    );
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveClass(
      'border-accent-red',
      'text-accent-red',
    );

    rerender(
      <ToggleButton pressed={false} tone="deny" onToggle={() => {}}>
        Yes
      </ToggleButton>,
    );
    const button = screen.getByRole('button', { name: 'Yes' });
    expect(button).toHaveClass('border-border', 'text-muted-foreground');
    expect(button).not.toHaveClass('text-accent-red');
  });
});
