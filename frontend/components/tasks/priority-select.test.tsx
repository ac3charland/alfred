import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { TaskPriority } from '@/lib/priority';

import { PrioritySelect } from './priority-select';

/** Open the priority dropdown and activate an item by name via keyboard (portal-safe). */
async function pick(user: ReturnType<typeof userEvent.setup>, name: RegExp): Promise<void> {
  await user.click(screen.getByRole('button'));
  await screen.findByRole('menu');
  const target = screen.getByRole('menuitem', { name });
  const itemCount = screen.getAllByRole('menuitem').length;
  for (let index = 0; index < itemCount; index += 1) {
    if (document.activeElement === target) break;
    await user.keyboard('[ArrowDown]');
  }
  expect(target).toHaveFocus();
  await user.keyboard('[Enter]');
}

function renderSelect(value: TaskPriority | null) {
  const onChange = jest.fn();
  render(<PrioritySelect id="priority-1" value={value} onChange={onChange} />);
  return { onChange };
}

describe('PrioritySelect', () => {
  it('shows "No priority" when unset', () => {
    renderSelect(null);
    expect(screen.getByRole('button')).toHaveTextContent('No priority');
  });

  it('shows the current level label when set', () => {
    renderSelect('high');
    expect(screen.getByRole('button')).toHaveTextContent('High');
  });

  it('calls onChange with the chosen level', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelect(null);

    await pick(user, /^Medium$/);

    expect(onChange).toHaveBeenCalledWith('medium');
  });

  it('clears to null when "No priority" is chosen', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelect('high');

    await pick(user, /No priority/);

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
