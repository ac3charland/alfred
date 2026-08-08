import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Chip } from '@/components/atoms/chip';
import { PickerChip, PickerListItem } from '@/components/atoms/picker-chip';

describe('PickerListItem', () => {
  it('marks only the active row with the trailing check', () => {
    render(
      <>
        <PickerListItem active onSelect={jest.fn()}>
          Active row
        </PickerListItem>
        <PickerListItem active={false} onSelect={jest.fn()}>
          Inactive row
        </PickerListItem>
      </>,
    );
    const [active, inactive] = screen.getAllByRole('button');
    expect(active?.querySelector('svg')).not.toBeNull();
    expect(inactive?.querySelector('svg')).toBeNull();
  });

  it('fires onSelect when clicked', async () => {
    const onSelect = jest.fn();
    const user = userEvent.setup();
    render(
      <PickerListItem active={false} onSelect={onSelect}>
        Pick me
      </PickerListItem>,
    );
    await user.click(screen.getByRole('button', { name: 'Pick me' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('PickerChip', () => {
  const options = [
    { value: null, label: 'No folder' },
    { value: 'f1', label: 'Health' },
    { value: 'f2', label: 'Work' },
  ];

  function renderChip(value: string | null, onSelect = jest.fn()) {
    render(
      <PickerChip
        trigger={<Chip aria-label="Folder">Health</Chip>}
        options={options}
        value={value}
        onSelect={onSelect}
      />,
    );
    return onSelect;
  }

  it('opens the option list from the trigger, with the current value ticked', async () => {
    const user = userEvent.setup();
    renderChip('f1');

    await user.click(screen.getByRole('button', { name: 'Folder' }));

    const active = await screen.findByRole('button', { name: 'Health' });
    const inactive = screen.getByRole('button', { name: 'Work' });
    expect(active.querySelector('svg')).not.toBeNull();
    expect(inactive.querySelector('svg')).toBeNull();
  });

  it('selects a value and closes the popover', async () => {
    const user = userEvent.setup();
    const onSelect = renderChip('f1');

    await user.click(screen.getByRole('button', { name: 'Folder' }));
    await user.click(await screen.findByRole('button', { name: 'Work' }));

    expect(onSelect).toHaveBeenCalledWith('f2');
    expect(screen.queryByRole('button', { name: 'Work' })).not.toBeInTheDocument();
  });

  it('passes null through for a clear entry', async () => {
    const user = userEvent.setup();
    const onSelect = renderChip('f1');

    await user.click(screen.getByRole('button', { name: 'Folder' }));
    await user.click(await screen.findByRole('button', { name: 'No folder' }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
