import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { FieldLabel } from './field-label';

describe('FieldLabel', () => {
  it('renders its text', () => {
    render(<FieldLabel>Due date</FieldLabel>);

    expect(screen.getByText('Due date')).toBeInTheDocument();
  });

  it('associates with a form control via htmlFor', () => {
    render(
      <>
        <FieldLabel htmlFor="notes-field">Notes</FieldLabel>
        <textarea id="notes-field" />
      </>,
    );

    // The control is reachable by the label's text → it's a real <label> association.
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
  });

  it('applies the eyebrow styling', () => {
    render(<FieldLabel>Due date</FieldLabel>);

    expect(screen.getByText('Due date')).toHaveClass('uppercase', 'tracking-widest', 'text-xs');
  });

  it('merges a custom className', () => {
    render(<FieldLabel className="text-muted-foreground/70">Inbox</FieldLabel>);

    expect(screen.getByText('Inbox')).toHaveClass('text-muted-foreground/70');
  });
});
