import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { FolderSortMenu } from './folder-sort-menu';

describe('FolderSortMenu', () => {
  it('names the mode it is currently sorting by on the trigger', () => {
    render(<FolderSortMenu value="priority" onChange={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Sort by: Priority' })).toBeInTheDocument();
  });

  it('names the due-date mode once that is the choice', () => {
    render(<FolderSortMenu value="due" onChange={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Sort by: Due date' })).toBeInTheDocument();
  });

  it('offers both orderings, check-marking the active one', async () => {
    const user = userEvent.setup();
    render(<FolderSortMenu value="due" onChange={jest.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Sort by: Due date' }));

    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toStrictEqual(['Priority', 'Due date']);
    // The teal check rides the active row only.
    expect(items[1]?.querySelector('.text-accent-teal')).toBeInTheDocument();
    expect(items[0]?.querySelector('.text-accent-teal')).not.toBeInTheDocument();
  });

  it('reports the picked mode', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<FolderSortMenu value="priority" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Sort by: Priority' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Due date' }));

    expect(onChange).toHaveBeenCalledWith('due');
  });

  it('highlights the trigger only once the folder is off the default ordering', () => {
    const { rerender } = render(<FolderSortMenu value="priority" onChange={jest.fn()} />);
    expect(screen.getByRole('button', { name: /^Sort by:/ }).className).not.toContain(
      'accent-teal',
    );

    rerender(<FolderSortMenu value="due" onChange={jest.fn()} />);
    expect(screen.getByRole('button', { name: /^Sort by:/ }).className).toContain('accent-teal');
  });
});
