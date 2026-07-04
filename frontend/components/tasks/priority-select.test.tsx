import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PriorityMenu } from './priority-select';

describe('PriorityMenu', () => {
  it('tints each level glyph with its accent colour (red / amber / blue)', async () => {
    const user = userEvent.setup();
    render(
      <PriorityMenu value={null} onChange={jest.fn()}>
        <button type="button">Set priority</button>
      </PriorityMenu>,
    );
    await user.click(screen.getByRole('button', { name: 'Set priority' }));

    const high = await screen.findByRole('menuitem', { name: 'High' });
    expect(high.querySelector('svg')).toHaveClass('text-accent-red');
    expect(screen.getByRole('menuitem', { name: 'Medium' }).querySelector('svg')).toHaveClass(
      'text-accent-amber',
    );
    expect(screen.getByRole('menuitem', { name: 'Low' }).querySelector('svg')).toHaveClass(
      'text-accent-blue',
    );
  });

  it('applies the picked level and check-marks the active one', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(
      <PriorityMenu value="medium" onChange={onChange}>
        <button type="button">Priority</button>
      </PriorityMenu>,
    );
    await user.click(screen.getByRole('button', { name: 'Priority' }));
    await user.click(await screen.findByRole('menuitem', { name: 'High' }));

    expect(onChange).toHaveBeenCalledWith('high');
  });
});
