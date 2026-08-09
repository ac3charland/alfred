import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { InlineNoteField } from './inline-note-field';

const COPY = {
  emptyLabel: 'Add folder description…',
  placeholder: 'Folder description…',
  editLabel: 'Edit folder description',
} as const;

function setup(overrides: Partial<React.ComponentProps<typeof InlineNoteField>> = {}) {
  const onSave = jest.fn();
  render(<InlineNoteField value={null} {...COPY} onSave={onSave} {...overrides} />);
  return { onSave, user: userEvent.setup() };
}

const trigger = () => screen.getByRole('button', { name: COPY.emptyLabel });
const editor = () => screen.getByRole('textbox', { name: COPY.editLabel });

describe('InlineNoteField', () => {
  it('shows the empty label when there is no value — the placeholder IS the discovery path', () => {
    setup();
    expect(trigger()).toBeInTheDocument();
  });

  it('treats an empty string like null', () => {
    setup({ value: '' });
    expect(trigger()).toBeInTheDocument();
  });

  it('shows the text when there is one', () => {
    setup({ value: 'Doctors, dentist, the gym.' });
    expect(screen.getByRole('button', { name: 'Doctors, dentist, the gym.' })).toBeInTheDocument();
    expect(screen.queryByText(COPY.emptyLabel)).not.toBeInTheDocument();
  });

  it('opens the editor in place, seeded with the current value', async () => {
    const { user } = setup({ value: 'The original.' });

    await user.click(screen.getByRole('button', { name: 'The original.' }));

    expect(editor()).toHaveValue('The original.');
    expect(screen.queryByRole('button', { name: 'The original.' })).not.toBeInTheDocument();
  });

  it('reports the trimmed value on Save and returns to the display', async () => {
    const { user, onSave } = setup();

    await user.click(trigger());
    await user.type(editor(), '  Anything about my health.  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith('Anything about my health.');
    // The line is controlled by the caller's store, so what it shows after a save is whatever
    // `value` becomes there — here, still the empty label. What matters is that it stopped editing.
    expect(screen.queryByRole('textbox', { name: COPY.editLabel })).not.toBeInTheDocument();
  });

  it('reports null — never an empty string — when the field is emptied', async () => {
    const { user, onSave } = setup({ value: 'The original.' });

    await user.click(screen.getByRole('button', { name: 'The original.' }));
    await user.clear(editor());
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(null);
  });

  it('reports nothing when the value is unchanged', async () => {
    const { user, onSave } = setup({ value: 'The original.' });

    await user.click(screen.getByRole('button', { name: 'The original.' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'The original.' })).toBeInTheDocument();
  });

  it('saves on ⌘↵ without reaching for the Save button', async () => {
    const { user, onSave } = setup();

    await user.click(trigger());
    await user.type(editor(), 'Typed then chorded{Meta>}{Enter}{/Meta}');

    expect(onSave).toHaveBeenCalledWith('Typed then chorded');
  });

  it('closes without reporting on Cancel', async () => {
    const { user, onSave } = setup({ value: 'The original.' });

    await user.click(screen.getByRole('button', { name: 'The original.' }));
    await user.type(editor(), ' and more');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'The original.' })).toBeInTheDocument();
  });

  it('closes without reporting on Escape', async () => {
    const { user, onSave } = setup({ value: 'The original.' });

    await user.click(screen.getByRole('button', { name: 'The original.' }));
    await user.type(editor(), ' and more{Escape}');

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'The original.' })).toBeInTheDocument();
  });

  it('re-seeds the draft from the current value after a cancelled edit', async () => {
    const { user } = setup({ value: 'The original.' });

    await user.click(screen.getByRole('button', { name: 'The original.' }));
    await user.type(editor(), ' and more');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'The original.' }));

    expect(editor()).toHaveValue('The original.');
  });

  it('restores the display value when the save is rejected', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    render(<InlineNoteField value="The original." {...COPY} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'The original.' }));
    await user.clear(editor());
    await user.type(editor(), 'Replaced');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The caller rolled its own state back, so the display still reads the old value — and
    // re-opening the editor must not resurrect the rejected draft.
    expect(screen.getByRole('button', { name: 'The original.' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'The original.' }));
    expect(editor()).toHaveValue('The original.');
  });

  it('forwards maxLength to the textarea, so the UI cannot produce a body the API rejects', async () => {
    const { user } = setup({ maxLength: 500 });

    await user.click(trigger());

    expect(editor()).toHaveAttribute('maxLength', '500');
  });

  it('leaves the textarea uncapped when no maxLength is given (the epic-notes call site)', async () => {
    const { user } = setup();

    await user.click(trigger());

    expect(editor()).not.toHaveAttribute('maxLength');
  });
});
