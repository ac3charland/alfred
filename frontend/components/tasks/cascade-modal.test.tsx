import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { CascadeModal } from './cascade-modal';

describe('CascadeModal', () => {
  const baseProperties = {
    open: true,
    onOpenChange: jest.fn(),
    taskTitle: 'Plan the launch',
    subtaskCount: 3,
    onConfirm: jest.fn(),
    isPending: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title, task name, and subtask count when open', () => {
    render(<CascadeModal {...baseProperties} />);

    expect(screen.getByText(/complete with subtasks/i)).toBeInTheDocument();
    expect(screen.getByText(/Plan the launch/)).toBeInTheDocument();
    expect(screen.getByText(/3 subtasks/)).toBeInTheDocument();
  });

  it('uses singular "subtask" when count is 1', () => {
    render(<CascadeModal {...baseProperties} subtaskCount={1} />);

    // Should NOT have "subtasks" (plural)
    expect(screen.queryByText(/1 subtasks/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 subtask/)).toBeInTheDocument();
  });

  it('calls onConfirm when Complete all is clicked', async () => {
    const onConfirm = jest.fn();
    const user = userEvent.setup();
    render(<CascadeModal {...baseProperties} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: /complete all/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const onOpenChange = jest.fn();
    const user = userEvent.setup();
    render(<CascadeModal {...baseProperties} onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables both buttons when isPending is true', () => {
    render(<CascadeModal {...baseProperties} isPending />);

    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /completing/i })).toBeDisabled();
  });

  it('shows "Completing…" label on the confirm button while pending', () => {
    render(<CascadeModal {...baseProperties} isPending />);

    expect(screen.getByRole('button', { name: /completing/i })).toBeInTheDocument();
  });

  it('does not render dialog content when open is false', () => {
    render(<CascadeModal {...baseProperties} open={false} />);

    expect(screen.queryByText(/complete with subtasks/i)).not.toBeInTheDocument();
  });
});
