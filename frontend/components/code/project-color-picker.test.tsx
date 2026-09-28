import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Button } from '@/components/atoms/button';
import type { ProjectColor } from '@/lib/code/project-color';

import { ProjectColorPicker } from './project-color-picker';

function renderPicker({
  value,
  slotColor = 'blue',
  onChange = jest.fn(),
}: {
  value: ProjectColor | null;
  slotColor?: ProjectColor;
  onChange?: jest.Mock;
}) {
  render(
    <ProjectColorPicker value={value} slotColor={slotColor} onChange={onChange}>
      <Button aria-label="Open picker">Palette</Button>
    </ProjectColorPicker>,
  );
  return onChange;
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open picker' }));
  return screen.findByRole('group', { name: 'Project color' });
}

describe('ProjectColorPicker', () => {
  it('stays closed until its trigger is clicked', () => {
    renderPicker({ value: null });

    expect(screen.queryByRole('group', { name: 'Project color' })).not.toBeInTheDocument();
  });

  it('offers exactly the five palette colours plus Automatic, named for a screen reader', async () => {
    const user = userEvent.setup();
    renderPicker({ value: null, slotColor: 'amber' });

    const group = await openPicker(user);

    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Blue', 'Amber', 'Green', 'Red', 'Teal', 'Automatic (amber)']);
  });

  it('shows Automatic with the slot colour it returns to', async () => {
    const user = userEvent.setup();
    renderPicker({ value: 'green', slotColor: 'red' });

    const group = await openPicker(user);

    const automatic = within(group).getByRole('button', { name: 'Automatic (red)' });
    expect(automatic).toHaveTextContent('Automatic');
    expect(automatic).toHaveTextContent('Red');
    expect(automatic.querySelector('.bg-accent-red')).not.toBeNull();
  });

  it('presses, rings and checks only the picked swatch', async () => {
    const user = userEvent.setup();
    renderPicker({ value: 'green' });

    const group = await openPicker(user);

    const green = within(group).getByRole('button', { name: 'Green' });
    expect(green).toHaveAttribute('aria-pressed', 'true');
    expect(within(green).getByTestId('project-color-swatch')).toHaveClass('ring-2');
    expect(within(green).getByTestId('project-color-check')).toBeInTheDocument();
    for (const name of ['Blue', 'Amber', 'Red', 'Teal', 'Automatic (blue)']) {
      const option = within(group).getByRole('button', { name });
      expect(option).toHaveAttribute('aria-pressed', 'false');
      expect(within(option).queryByTestId('project-color-check')).not.toBeInTheDocument();
    }
    const blue = within(group).getByRole('button', { name: 'Blue' });
    expect(within(blue).getByTestId('project-color-swatch')).not.toHaveClass('ring-2');
  });

  it('fills each swatch with its own colour', async () => {
    const user = userEvent.setup();
    renderPicker({ value: null });

    const group = await openPicker(user);

    for (const [name, fill] of [
      ['Teal', 'bg-accent-teal'],
      ['Amber', 'bg-accent-amber'],
    ] as const) {
      const swatch = within(within(group).getByRole('button', { name })).getByTestId(
        'project-color-swatch',
      );
      expect(swatch).toHaveClass(fill);
    }
  });

  it('presses and checks Automatic when there is no stored pick', async () => {
    const user = userEvent.setup();
    renderPicker({ value: null });

    const group = await openPicker(user);

    const automatic = within(group).getByRole('button', { name: 'Automatic (blue)' });
    expect(automatic).toHaveAttribute('aria-pressed', 'true');
    expect(within(automatic).getByTestId('project-color-check')).toBeInTheDocument();
  });

  it('fires onChange with the picked colour and closes', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker({ value: null });

    const group = await openPicker(user);
    await user.click(within(group).getByRole('button', { name: 'Teal' }));

    expect(onChange).toHaveBeenCalledWith('teal');
    expect(screen.queryByRole('group', { name: 'Project color' })).not.toBeInTheDocument();
  });

  it('fires onChange with null for Automatic and closes', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker({ value: 'red' });

    const group = await openPicker(user);
    await user.click(within(group).getByRole('button', { name: 'Automatic (blue)' }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('group', { name: 'Project color' })).not.toBeInTheDocument();
  });

  it('just closes, with no change, when the current swatch is picked again', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker({ value: 'green' });

    const group = await openPicker(user);
    await user.click(within(group).getByRole('button', { name: 'Green' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Project color' })).not.toBeInTheDocument();
  });

  it('just closes, with no change, when Automatic is picked while already automatic', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker({ value: null });

    const group = await openPicker(user);
    await user.click(within(group).getByRole('button', { name: 'Automatic (blue)' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Project color' })).not.toBeInTheDocument();
  });

  it('closes on Escape without a change', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker({ value: null });

    await openPicker(user);
    await user.keyboard('{Escape}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Project color' })).not.toBeInTheDocument();
  });
});
