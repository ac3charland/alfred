import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { InlineEditTrigger } from './inline-edit-trigger';

describe('InlineEditTrigger', () => {
  it('renders a button with its children', () => {
    render(<InlineEditTrigger>Set a due date…</InlineEditTrigger>);

    expect(screen.getByRole('button', { name: 'Set a due date…' })).toBeInTheDocument();
  });

  it('defaults to type="button"', () => {
    render(<InlineEditTrigger>Edit</InlineEditTrigger>);

    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('type', 'button');
  });

  it('applies the shared left-aligned, rounded, teal-ring base', () => {
    render(<InlineEditTrigger>Edit</InlineEditTrigger>);

    expect(screen.getByRole('button', { name: 'Edit' })).toHaveClass(
      'rounded-sm',
      'text-left',
      'focus-visible:ring-accent-teal',
    );
  });

  it('merges a per-site className', () => {
    render(<InlineEditTrigger className="flex-1 text-sm">Edit</InlineEditTrigger>);

    expect(screen.getByRole('button', { name: 'Edit' })).toHaveClass('flex-1', 'text-sm');
  });

  it('begins editing on click', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<InlineEditTrigger onClick={onClick}>Edit</InlineEditTrigger>);

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
