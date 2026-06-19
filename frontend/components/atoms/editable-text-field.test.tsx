import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EditableTextField } from './editable-text-field';

describe('EditableTextField', () => {
  it('shows the display content and enters edit mode on click', async () => {
    const user = userEvent.setup();
    render(
      <EditableTextField value="Old title" onSave={jest.fn()} label="Edit title">
        <span>Old title</span>
      </EditableTextField>,
    );

    expect(screen.queryByLabelText('Edit title')).not.toBeInTheDocument();
    await user.click(screen.getByText('Old title'));
    expect(screen.getByLabelText('Edit title')).toHaveValue('Old title');
  });

  it('saves an edited value via the confirm button', async () => {
    const user = userEvent.setup();
    const onSave = jest.fn(() => Promise.resolve());
    render(
      <EditableTextField value="Old" onSave={onSave} label="Edit title">
        <span>Old</span>
      </EditableTextField>,
    );

    await user.click(screen.getByText('Old'));
    const input = screen.getByLabelText('Edit title');
    await user.clear(input);
    await user.type(input, 'New');
    await user.click(screen.getByRole('button', { name: 'Confirm title' }));

    expect(onSave).toHaveBeenCalledWith('New');
  });

  it('saves on Enter', async () => {
    const user = userEvent.setup();
    const onSave = jest.fn(() => Promise.resolve());
    render(
      <EditableTextField value="Old" onSave={onSave} label="Edit title">
        <span>Old</span>
      </EditableTextField>,
    );

    await user.click(screen.getByText('Old'));
    const input = screen.getByLabelText('Edit title');
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');
    expect(onSave).toHaveBeenCalledWith('Renamed');
  });

  it('cancels on Escape without saving', async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    render(
      <EditableTextField value="Old" onSave={onSave} label="Edit title">
        <span>Old</span>
      </EditableTextField>,
    );

    await user.click(screen.getByText('Old'));
    await user.type(screen.getByLabelText('Edit title'), 'Discarded{Escape}');
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Edit title')).not.toBeInTheDocument();
  });
});
