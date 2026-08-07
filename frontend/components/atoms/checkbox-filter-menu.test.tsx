import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { CheckboxFilterMenu, type FilterOption } from './checkbox-filter-menu';

const OPTIONS: readonly FilterOption<string>[] = [
  { value: 'a', label: 'Alfred' },
  { value: 'b', label: 'Relay' },
  { value: 'c', label: 'Beacon' },
];

const ALL = OPTIONS.map((option) => option.value);

function Harness({ initial }: { initial: readonly string[] }) {
  const [selected, setSelected] = React.useState<readonly string[]>(initial);
  const toggle = (value: string) => {
    setSelected((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  };
  return (
    <CheckboxFilterMenu
      label="Filter by thing"
      options={OPTIONS}
      selected={selected}
      onToggle={toggle}
      isFiltering={selected.length !== OPTIONS.length}
    />
  );
}

describe('CheckboxFilterMenu', () => {
  it('labels the trigger with the caller’s label and shows no count at rest', () => {
    render(
      <CheckboxFilterMenu
        label="Filter by thing"
        options={OPTIONS}
        selected={ALL}
        onToggle={jest.fn()}
        isFiltering={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Filter by thing' })).toBeInTheDocument();
  });

  it('appends the selected count to the trigger while filtering', () => {
    render(
      <CheckboxFilterMenu
        label="Filter by thing"
        options={OPTIONS}
        selected={['b']}
        onToggle={jest.fn()}
        isFiltering
      />,
    );
    expect(screen.getByRole('button', { name: 'Filter by thing (1)' })).toBeInTheDocument();
  });

  it('renders one checkbox per option, checked per the selection', async () => {
    const user = userEvent.setup();
    render(
      <CheckboxFilterMenu
        label="Filter by thing"
        options={OPTIONS}
        selected={['c']}
        onToggle={jest.fn()}
        isFiltering
      />,
    );

    await user.click(screen.getByRole('button', { name: /filter by thing/i }));
    await screen.findByRole('menu');

    expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(OPTIONS.length);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Alfred' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Beacon' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('toggles an option and keeps the menu open for a multi-select pass', async () => {
    const user = userEvent.setup();
    render(<Harness initial={ALL} />);

    // Radix portals set pointer-events:none on the body, so drive the menu by keyboard.
    await user.click(screen.getByRole('button', { name: /filter by thing/i }));
    await screen.findByRole('menu');
    await user.keyboard('[ArrowDown][Enter]');

    expect(screen.getByRole('menuitemcheckbox', { name: 'Alfred' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('accepts a rich (non-string) option label while keeping its accessible name', async () => {
    const user = userEvent.setup();
    render(
      <CheckboxFilterMenu
        label="Filter by thing"
        options={[{ value: 'a', label: <span data-testid="rich">Alfred</span> }]}
        selected={['a']}
        onToggle={jest.fn()}
        isFiltering={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: /filter by thing/i }));
    await screen.findByRole('menu');

    expect(screen.getByTestId('rich')).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Alfred' })).toBeInTheDocument();
  });
});
