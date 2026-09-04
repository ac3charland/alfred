import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { DropdownMenuSelectSub } from '@/components/atoms/dropdown-menu-select-sub';

const OPTIONS = [
  { value: null, label: 'No folder' },
  { value: 'f1', label: 'Work' },
  { value: 'f2', label: 'Home' },
];

/**
 * The atom only makes sense inside an open menu, so every case mounts it in one and opens it.
 * Radix portals the menu and puts `pointer-events: none` on the body, so submenus are driven by
 * keyboard (hover the sub-trigger → ArrowRight opens it) — synthetic clicks race the safe
 * triangle, exactly as the row-menu tests document.
 */
async function openMenu(
  props: Partial<React.ComponentProps<typeof DropdownMenuSelectSub>> = {},
): Promise<{ user: ReturnType<typeof userEvent.setup>; onSelect: jest.Mock }> {
  const onSelect = jest.fn();
  const user = userEvent.setup();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>More actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuSelectSub
          label="Folder…"
          value={null}
          options={OPTIONS}
          onSelect={onSelect}
          {...props}
        />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  await screen.findByRole('menu');
  return { user, onSelect };
}

/** Open the sub-trigger's submenu and wait for its first option. */
async function openSubmenu(user: ReturnType<typeof userEvent.setup>, name = 'Folder…') {
  await user.hover(screen.getByRole('menuitem', { name }));
  await user.keyboard('[ArrowRight]');
  await screen.findByRole('menuitem', { name: 'No folder' });
}

describe('DropdownMenuSelectSub', () => {
  it('renders every option behind its sub-trigger', async () => {
    const { user } = await openMenu();
    await openSubmenu(user);

    expect(screen.getByRole('menuitem', { name: 'No folder' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Work' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Home' })).toBeInTheDocument();
  });

  it('ticks only the current value', async () => {
    const { user } = await openMenu({ value: 'f1' });
    await openSubmenu(user);

    expect(screen.getByRole('menuitem', { name: 'Work' }).querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Home' }).querySelector('svg')).toBeNull();
  });

  it('ticks the clear entry when the value is null', async () => {
    const { user } = await openMenu({ value: null });
    await openSubmenu(user);

    expect(screen.getByRole('menuitem', { name: 'No folder' }).querySelector('svg')).not.toBeNull();
  });

  it('reports the picked value', async () => {
    const { user, onSelect } = await openMenu({ value: null });
    await openSubmenu(user);
    // ArrowRight lands on the first item ("No folder"); step down to "Work" and select.
    await user.keyboard('[ArrowDown][Enter]');

    expect(onSelect).toHaveBeenCalledWith('f1');
  });

  it('reports null when the clear entry is picked', async () => {
    const { user, onSelect } = await openMenu({ value: 'f1' });
    await openSubmenu(user);
    await user.keyboard('[Enter]');

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('draws a separator after the named option index', async () => {
    const { user } = await openMenu({ separatorAfter: 0 });
    await openSubmenu(user);

    // The separator sits between the clear entry and the first real option.
    const separator = screen.getByRole('separator');
    expect(separator.previousElementSibling).toHaveTextContent('No folder');
    expect(separator.nextElementSibling).toHaveTextContent('Work');
  });

  it('draws no separator when none is named', async () => {
    const { user } = await openMenu();
    await openSubmenu(user);

    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('disables the trigger and shows its hint as visible text as well as a title', async () => {
    // A disabled sub-trigger is `pointer-events-none`, so no tooltip can ever be hovered into
    // view — the hint has to be readable without one.
    await openMenu({ label: 'Epic…', disabled: true, hint: 'Pick a project first' });

    const trigger = screen.getByRole('menuitem', { name: /epic/i });
    expect(trigger).toHaveAttribute('data-disabled');
    expect(trigger).toHaveAttribute('title', 'Pick a project first');
    expect(trigger).toHaveTextContent('Pick a project first');
  });

  it('carries no title while enabled', async () => {
    await openMenu({ hint: 'Pick a project first' });

    expect(screen.getByRole('menuitem', { name: 'Folder…' })).not.toHaveAttribute('title');
  });
});
