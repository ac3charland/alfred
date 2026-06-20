import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { TextField } from './text-field';

describe('TextField', () => {
  it('renders a text input', () => {
    render(<TextField aria-label="Title" />);

    expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
  });

  it('reflects a controlled value and reports changes', async () => {
    function Controlled() {
      const [value, setValue] = React.useState('');
      return (
        <TextField
          aria-label="Title"
          value={value}
          onChange={(event_) => {
            setValue(event_.target.value);
          }}
        />
      );
    }
    const user = userEvent.setup();
    render(<Controlled />);

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Hello');

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Hello');
  });

  it('forwards the placeholder and disabled props', () => {
    render(<TextField placeholder="Folder name…" disabled />);

    const input = screen.getByPlaceholderText('Folder name…');
    expect(input).toBeDisabled();
  });

  it('forwards a ref so the caller can focus the input', () => {
    function Focuser() {
      const reference = React.useRef<HTMLInputElement>(null);
      React.useEffect(() => {
        reference.current?.focus();
      }, []);
      return <TextField ref={reference} aria-label="Title" />;
    }
    render(<Focuser />);

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus();
  });

  it('applies the inline-field base styling (border, input bg, teal focus ring)', () => {
    render(<TextField aria-label="Title" />);

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveClass(
      'border',
      'bg-input',
      'focus-visible:ring-accent-teal',
    );
  });

  it('merges a custom className', () => {
    render(<TextField aria-label="Title" className="flex-1" />);

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveClass('flex-1');
  });

  it('defaults to type="text" when no type prop is given', () => {
    render(<TextField aria-label="Title" />);

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveAttribute('type', 'text');
  });

  it('respects an explicit input type', () => {
    render(<TextField aria-label="Due date" type="date" />);

    // type="date" inputs are not exposed with the textbox role.
    expect(screen.queryByRole('textbox', { name: 'Due date' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Due date')).toHaveAttribute('type', 'date');
  });

  it('applies the placeholder + disabled-state styling', () => {
    render(<TextField aria-label="Title" />);

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveClass(
      'placeholder:text-muted-foreground',
      'disabled:cursor-not-allowed',
      'disabled:opacity-50',
    );
  });

  it('exposes a stable displayName for devtools', () => {
    expect(TextField.displayName).toBe('TextField');
  });
});
