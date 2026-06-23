import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import type { CodeStory } from '@/lib/types';

import { NewStoryDialog } from './new-story-dialog';

/** A minimal reconciled story the resolved `onCreateStory` hands back. */
const CREATED = { item_id: 'i1', ref: 'ALF-9' } as CodeStory;

function renderDialog(overrides: Partial<React.ComponentProps<typeof NewStoryDialog>> = {}) {
  const onCreateStory = overrides.onCreateStory ?? jest.fn().mockResolvedValue(CREATED);
  const onOpenChange = overrides.onOpenChange ?? jest.fn();
  render(
    <NewStoryDialog
      open
      onOpenChange={onOpenChange}
      epicName={overrides.epicName ?? 'Communication Firewall'}
      epicRef={overrides.epicRef ?? 'ALF-1'}
      onCreateStory={onCreateStory}
    />,
  );
  return { onCreateStory, onOpenChange };
}

describe('NewStoryDialog', () => {
  it('names the epic and states the story lands at Needs Refinement', () => {
    renderDialog();
    expect(screen.getByText(/new story in/i)).toBeInTheDocument();
    expect(screen.getByText('Communication Firewall')).toBeInTheDocument();
    expect(screen.getByText(/needs refinement/i)).toBeInTheDocument();
  });

  it('autofocuses the title field on open', () => {
    renderDialog();
    expect(screen.getByLabelText(/title/i)).toHaveFocus();
  });

  it('disables Create until the title is non-empty (trimmed)', async () => {
    const user = userEvent.setup();
    renderDialog();

    const create = screen.getByRole('button', { name: /^create$/i });
    expect(create).toBeDisabled();

    // Whitespace alone does not enable it.
    await user.type(screen.getByLabelText(/title/i), ' '.repeat(3));
    expect(create).toBeDisabled();

    await user.type(screen.getByLabelText(/title/i), 'Real title');
    expect(create).toBeEnabled();
  });

  it('submits the trimmed title and null for empty notes', async () => {
    const user = userEvent.setup();
    const { onCreateStory } = renderDialog();

    await user.type(screen.getByLabelText(/title/i), '  Ship it  ');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(onCreateStory).toHaveBeenCalledWith('Ship it', null);
  });

  it('passes the trimmed notes when provided', async () => {
    const user = userEvent.setup();
    const { onCreateStory } = renderDialog();

    await user.type(screen.getByLabelText(/title/i), 'A story');
    await user.type(screen.getByLabelText(/notes/i), '  some detail  ');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(onCreateStory).toHaveBeenCalledWith('A story', 'some detail');
  });

  it('closes on success', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.type(screen.getByLabelText(/title/i), 'A story');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('closes without creating when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const { onCreateStory, onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCreateStory).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes without creating when Escape is pressed', async () => {
    const user = userEvent.setup();
    const { onCreateStory, onOpenChange } = renderDialog();

    await user.keyboard('{Escape}');

    expect(onCreateStory).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('shows an inline error and keeps the dialog open when the create rejects', async () => {
    const user = userEvent.setup();
    const onCreateStory = jest.fn().mockRejectedValue(new Error('boom'));
    const { onOpenChange } = renderDialog({ onCreateStory });

    await user.type(screen.getByLabelText(/title/i), 'A story');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText(/could not create the story/i)).toBeInTheDocument();
    // The dialog was never asked to close.
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
