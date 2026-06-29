import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Chip } from './chip';

describe('Chip', () => {
  it('renders its children inside a button', () => {
    render(<Chip>Set a due date…</Chip>);
    expect(screen.getByRole('button', { name: 'Set a due date…' })).toBeInTheDocument();
  });

  it('defaults to type="button" so it never submits a form', () => {
    render(<Chip>Repeat</Chip>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('merges a caller className for the tone', () => {
    render(<Chip className="text-accent-blue">Jul 2</Chip>);
    expect(screen.getByRole('button')).toHaveClass('text-accent-blue');
  });

  it('forwards onClick', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<Chip onClick={onClick}>Priority</Chip>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
