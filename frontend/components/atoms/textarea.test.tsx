import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { Textarea } from './textarea';

describe('Textarea', () => {
  it('renders a textarea', () => {
    render(<Textarea aria-label="Notes" />);

    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument();
  });

  it('reflects a controlled value and reports changes', async () => {
    function Controlled() {
      const [value, setValue] = React.useState('');
      return (
        <Textarea
          aria-label="Notes"
          value={value}
          onChange={(event_) => {
            setValue(event_.target.value);
          }}
        />
      );
    }
    const user = userEvent.setup();
    render(<Controlled />);

    await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'Hello');

    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Hello');
  });

  it('forwards the placeholder and disabled props', () => {
    render(<Textarea placeholder="Add notes…" disabled />);

    const textarea = screen.getByPlaceholderText('Add notes…');
    expect(textarea).toBeDisabled();
  });

  it('forwards a ref so the caller can focus the textarea', () => {
    function Focuser() {
      const reference = React.useRef<HTMLTextAreaElement>(null);
      React.useEffect(() => {
        reference.current?.focus();
      }, []);
      return <Textarea ref={reference} aria-label="Notes" />;
    }
    render(<Focuser />);

    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveFocus();
  });

  it('applies the bordered base styling (border, input bg, teal focus ring) by default', () => {
    render(<Textarea aria-label="Notes" />);

    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveClass(
      'border',
      'bg-input',
      'focus-visible:ring-accent-teal',
    );
  });

  it('drops the bordered chrome when unstyled', () => {
    render(<Textarea aria-label="Capture" unstyled />);

    const textarea = screen.getByRole('textbox', { name: 'Capture' });
    expect(textarea).not.toHaveClass('border', 'bg-input', 'focus-visible:ring-accent-teal');
    // Still a textarea with the shared resize/focus base.
    expect(textarea).toHaveClass('w-full', 'resize-none', 'focus:outline-none');
  });

  it('merges a custom className', () => {
    render(<Textarea aria-label="Notes" className="rounded-2xl bg-transparent" />);

    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveClass(
      'rounded-2xl',
      'bg-transparent',
    );
  });
});
