import { render, screen } from '@testing-library/react';

import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the title with the serif headline classes', () => {
    render(<EmptyState title="Your inbox is empty" />);
    const title = screen.getByText('Your inbox is empty');
    expect(title).toHaveClass('font-serif', 'text-2xl', 'text-muted-foreground/50');
  });

  it('renders the description when provided', () => {
    render(<EmptyState title="Folder not found" description="It may have been deleted." />);
    const description = screen.getByText('It may have been deleted.');
    expect(description).toHaveClass('text-sm', 'text-muted-foreground/40');
  });

  it('omits the description line when not provided', () => {
    const { container } = render(<EmptyState title="No tasks yet" />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('renders the action beneath the description when provided', () => {
    const { container } = render(
      <EmptyState
        title="No tasks in Someday"
        description="Add your first task to this folder."
        action={<button type="button">Add task</button>}
      />,
    );

    const action = screen.getByRole('button', { name: 'Add task' });
    expect(container.firstElementChild?.lastElementChild).toContainElement(action);
  });

  it('renders nothing extra when no action is given', () => {
    // The Inbox and not-found callers pass no action and must be untouched.
    render(<EmptyState title="Your inbox is empty" description="Capture something above." />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
