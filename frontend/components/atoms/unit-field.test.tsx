import { render, screen } from '@testing-library/react';

import { UnitField } from './unit-field';

describe('UnitField', () => {
  it('shows the unit beside the number and announces it with the value', () => {
    render(<UnitField aria-label="Meditate" unit="min" defaultValue="20" />);

    const field = screen.getByLabelText('Meditate');
    expect(field).toHaveValue('20');
    expect(field).toHaveAccessibleDescription('min');
    expect(screen.getByText('min')).toBeInTheDocument();
  });

  it('is a plain field when the number carries no unit of its own', () => {
    render(<UnitField aria-label="Glasses" defaultValue="3" />);

    expect(screen.getByLabelText('Glasses')).toHaveAccessibleDescription('');
  });

  it('keeps a caller’s own description alongside the unit', () => {
    render(
      <>
        <span id="hint">rounded to the nearest minute</span>
        <UnitField aria-label="Meditate" unit="min" aria-describedby="hint" />
      </>,
    );

    expect(screen.getByLabelText('Meditate')).toHaveAccessibleDescription(
      'rounded to the nearest minute min',
    );
  });

  it('forwards the input props the field is driven by', () => {
    render(<UnitField aria-label="Meditate" unit="min" type="number" disabled />);

    const field = screen.getByLabelText('Meditate');
    expect(field).toHaveAttribute('type', 'number');
    expect(field).toBeDisabled();
  });
});
