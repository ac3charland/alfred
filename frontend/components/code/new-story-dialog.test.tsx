import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { NewStoryDialog } from './new-story-dialog';

type CreateStoryFn = (title: string, notes: string | null) => Promise<void>;

function makeCreateStory(impl?: () => void): jest.MockedFunction<CreateStoryFn> {
  const mock: jest.MockedFunction<CreateStoryFn> = jest.fn();
  mock.mockImplementation(
    impl
      ? () => {
          impl();
          return Promise.resolve();
        }
      : () => Promise.resolve(),
  );
  return mock;
}

function renderDialog(
  overrides: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    epicName?: string;
    onCreateStory?: CreateStoryFn;
  } = {},
) {
  const onOpenChange = overrides.onOpenChange ?? jest.fn();
  const onCreateStory = overrides.onCreateStory ?? makeCreateStory();
  render(
    <NewStoryDialog
      open={overrides.open ?? true}
      onOpenChange={onOpenChange}
      epicName={overrides.epicName ?? 'Communication Firewall'}
      onCreateStory={onCreateStory}
    />,
  );
  return { onOpenChange, onCreateStory };
}

describe('NewStoryDialog', () => {
  it('shows the epic name in the dialog title', () => {
    renderDialog({ epicName: 'My Epic' });

    expect(screen.getByRole('heading', { name: /new story in my epic/i })).toBeInTheDocument();
  });

  it('mentions Needs Refinement in the description', () => {
    renderDialog();

    expect(screen.getByText(/needs refinement/i)).toBeInTheDocument();
  });

  it('renders a required Title field and an optional Notes field', () => {
    renderDialog();

    expect(screen.getByLabelText(/^title$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^notes$/i)).toBeInTheDocument();
  });

  it('disables Create when the title is empty', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
  });

  it('enables Create once the title is non-empty', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(/^title$/i), 'Wire the webhook');

    expect(screen.getByRole('button', { name: /^create$/i })).toBeEnabled();
  });

  it('calls onCreateStory with the trimmed title and null for empty notes on submit', async () => {
    const user = userEvent.setup();
    const { onCreateStory } = renderDialog();

    await user.type(screen.getByLabelText(/^title$/i), '  story title  ');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(onCreateStory).toHaveBeenCalledWith('story title', null);
    });
  });

  it('calls onCreateStory with non-empty notes when notes are filled', async () => {
    const user = userEvent.setup();
    const { onCreateStory } = renderDialog();

    await user.type(screen.getByLabelText(/^title$/i), 'My story');
    await user.type(screen.getByLabelText(/^notes$/i), 'Some context');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(onCreateStory).toHaveBeenCalledWith('My story', 'Some context');
    });
  });

  it('closes the dialog on successful create', async () => {
    const user = userEvent.setup();
    const onOpenChange: jest.MockedFunction<(open: boolean) => void> = jest.fn();
    const onCreateStory = makeCreateStory();
    render(
      <NewStoryDialog
        open
        onOpenChange={onOpenChange}
        epicName="Epic"
        onCreateStory={onCreateStory}
      />,
    );

    await user.type(screen.getByLabelText(/^title$/i), 'A story');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('shows an inline error and keeps the dialog open when onCreateStory rejects', async () => {
    const user = userEvent.setup();
    const onOpenChange: jest.MockedFunction<(open: boolean) => void> = jest.fn();
    const onCreateStory: jest.MockedFunction<CreateStoryFn> = jest.fn();
    onCreateStory.mockRejectedValue(new Error('API error'));
    render(
      <NewStoryDialog
        open
        onOpenChange={onOpenChange}
        epicName="Epic"
        onCreateStory={onCreateStory}
      />,
    );

    await user.type(screen.getByLabelText(/^title$/i), 'A story');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not create the story/i)).toBeInTheDocument();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('calls onOpenChange(false) when Cancel is clicked without calling onCreateStory', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onCreateStory } = renderDialog();

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreateStory).not.toHaveBeenCalled();
  });

  it('does not render when open is false', () => {
    renderDialog({ open: false });

    expect(screen.queryByRole('heading', { name: /new story in/i })).not.toBeInTheDocument();
  });
});
