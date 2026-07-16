import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import type { CodeFactoryState } from '@/lib/types';

import { StatusFilterMenu } from './status-filter-menu';

const OPTIONS: readonly CodeFactoryState[] = ['needs_refinement', 'in_development', 'done'];

function Harness({ initial }: { initial: readonly CodeFactoryState[] }) {
  const [selected, setSelected] = React.useState<readonly CodeFactoryState[]>(initial);
  const toggle = (state: CodeFactoryState) => {
    setSelected((current) =>
      current.includes(state) ? current.filter((s) => s !== state) : [...current, state],
    );
  };
  return (
    <StatusFilterMenu
      options={OPTIONS}
      selected={selected}
      onToggle={toggle}
      isFiltering={selected.length !== OPTIONS.length}
    />
  );
}

describe('StatusFilterMenu', () => {
  it('labels the trigger and shows no count at the resting (all-selected) state', () => {
    render(
      <StatusFilterMenu
        options={OPTIONS}
        selected={OPTIONS}
        onToggle={jest.fn()}
        isFiltering={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Filter by status' })).toBeInTheDocument();
  });

  it('shows the selected count on the trigger while filtering', () => {
    render(
      <StatusFilterMenu
        options={OPTIONS}
        selected={['in_development']}
        onToggle={jest.fn()}
        isFiltering
      />,
    );
    expect(screen.getByRole('button', { name: 'Filter by status (1)' })).toBeInTheDocument();
  });

  it('renders one human-labelled checkbox per option, checked per the selection', async () => {
    const user = userEvent.setup();
    render(
      <StatusFilterMenu options={OPTIONS} selected={['done']} onToggle={jest.fn()} isFiltering />,
    );

    await user.click(screen.getByRole('button', { name: /filter by status/i }));
    await screen.findByRole('menu');

    expect(screen.getByRole('menuitemcheckbox', { name: 'Needs Refinement' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Done' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('renders exactly one checkbox per option and no separator', async () => {
    const user = userEvent.setup();
    render(
      <StatusFilterMenu
        options={OPTIONS}
        selected={OPTIONS}
        onToggle={jest.fn()}
        isFiltering={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: /filter by status/i }));
    await screen.findByRole('menu');

    expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(OPTIONS.length);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('toggles a state and keeps the menu open for a multi-select pass', async () => {
    const user = userEvent.setup();
    render(<Harness initial={OPTIONS} />);

    // Radix portals set pointer-events:none on the body, so drive the menu by keyboard.
    await user.click(screen.getByRole('button', { name: /filter by status/i }));
    await screen.findByRole('menu');
    // The 1st option (Needs Refinement) toggles off; the menu stays open (onSelect prevented).
    await user.keyboard('[ArrowDown][Enter]');

    expect(screen.getByRole('menuitemcheckbox', { name: 'Needs Refinement' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
