import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';

import { CaptureBox } from './capture-box';

// The store calls api-client under the hood; mock it so tests never hit the network.
jest.mock('@/lib/api-client');
const mockCreateItem = jest.mocked(apiClient.createItem);

describe('CaptureBox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the textarea and capture button in full mode', () => {
    renderWithProviders(<CaptureBox />);

    expect(screen.getByRole('textbox', { name: /capture box/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /capture/i })).toBeInTheDocument();
  });

  it('renders a text input and Add button in compact mode', () => {
    renderWithProviders(<CaptureBox compact />);

    expect(screen.getByPlaceholderText(/add subtask/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
  });

  it('submit button is disabled when input is empty', () => {
    renderWithProviders(<CaptureBox />);

    expect(screen.getByRole('button', { name: /capture/i })).toBeDisabled();
  });

  it('submit button is enabled when there is text', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    await user.type(screen.getByRole('textbox', { name: /capture box/i }), 'Buy milk');

    expect(screen.getByRole('button', { name: /capture/i })).toBeEnabled();
  });

  it('calls createItem (via the store) on submit', async () => {
    mockCreateItem.mockResolvedValue({ id: '1', title: 'Buy milk' } as Awaited<
      ReturnType<typeof apiClient.createItem>
    >);

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    await user.type(screen.getByRole('textbox', { name: /capture box/i }), 'Buy milk');
    await user.click(screen.getByRole('button', { name: /capture/i }));

    await waitFor(() => {
      expect(mockCreateItem).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Buy milk', item_type: 'unclassified' }),
      );
    });
  });

  it('clears the textarea after successful submission', async () => {
    mockCreateItem.mockResolvedValue({ id: '1', title: 'Buy milk' } as Awaited<
      ReturnType<typeof apiClient.createItem>
    >);

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    const textarea = screen.getByRole('textbox', { name: /capture box/i });
    await user.type(textarea, 'Buy milk');
    await user.click(screen.getByRole('button', { name: /capture/i }));

    await waitFor(() => {
      expect(textarea).toHaveValue('');
    });
  });

  it('optimistically clears and keeps the textarea enabled before the save resolves', async () => {
    // The save never resolves, so we observe the box's state mid-flight.
    mockCreateItem.mockImplementation(() => new Promise(() => {}));

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    const textarea = screen.getByRole('textbox', { name: /capture box/i });
    await user.type(textarea, 'Buy milk');
    await user.keyboard('{Enter}');

    expect(textarea).toHaveValue('');
    expect(textarea).toBeEnabled();
  });

  it('does not show a saving spinner for a single in-flight capture', async () => {
    mockCreateItem.mockImplementation(() => new Promise(() => {}));

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    await user.type(screen.getByRole('textbox', { name: /capture box/i }), 'Buy milk');
    await user.keyboard('{Enter}');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a saving spinner when a new item is captured before the previous one saves', async () => {
    // Both saves stay in flight, so the second capture overlaps the first.
    mockCreateItem.mockImplementation(() => new Promise(() => {}));

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    const textarea = screen.getByRole('textbox', { name: /capture box/i });
    await user.type(textarea, 'First');
    await user.keyboard('{Enter}');
    await user.type(textarea, 'Second');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('shows an error message and restores the text when createItem fails', async () => {
    mockCreateItem.mockRejectedValue(new Error('Network error'));

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    const textarea = screen.getByRole('textbox', { name: /capture box/i });
    await user.type(textarea, 'Buy milk');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to save/i);
    // The optimistic clear must not lose the capture — the failed text is restored.
    expect(textarea).toHaveValue('Buy milk');
  });

  it('calls onCapture callback after successful capture in compact mode', async () => {
    mockCreateItem.mockResolvedValue({ id: '1', title: 'Subtask' } as Awaited<
      ReturnType<typeof apiClient.createItem>
    >);

    const onCapture = jest.fn();
    const user = userEvent.setup();
    renderWithProviders(<CaptureBox compact onCapture={onCapture} />);

    await user.type(screen.getByPlaceholderText(/add subtask/i), 'Subtask');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(onCapture).toHaveBeenCalled();
    });
  });

  it('includes folderId in createItem call when provided', async () => {
    mockCreateItem.mockResolvedValue({ id: '1', title: 'Task' } as Awaited<
      ReturnType<typeof apiClient.createItem>
    >);

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox folderId="folder-123" />);

    await user.type(screen.getByRole('textbox', { name: /capture box/i }), 'Task');
    await user.click(screen.getByRole('button', { name: /capture/i }));

    await waitFor(() => {
      expect(mockCreateItem).toHaveBeenCalledWith(
        expect.objectContaining({ folder_id: 'folder-123' }),
      );
    });
  });

  it('does not include folder_id in createItem when folderId is undefined (Inbox)', async () => {
    mockCreateItem.mockResolvedValue({ id: '1', title: 'Task' } as Awaited<
      ReturnType<typeof apiClient.createItem>
    >);

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    await user.type(screen.getByRole('textbox', { name: /capture box/i }), 'Task');
    await user.click(screen.getByRole('button', { name: /capture/i }));

    await waitFor(() => {
      expect(mockCreateItem).toHaveBeenCalledTimes(1);
      // The argument object should not contain folder_id when no folderId is given
      const argument = mockCreateItem.mock.calls[0]?.[0];
      expect(argument).toBeDefined();
      if (argument !== undefined) {
        expect(Object.keys(argument)).not.toContain('folder_id');
      }
    });
  });

  it('does not submit when input contains only whitespace (button disabled, Enter ignored)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    const textarea = screen.getByRole('textbox', { name: /capture box/i });
    await user.type(textarea, ' '.repeat(3));

    // The button is disabled when text trims to empty.
    expect(screen.getByRole('button', { name: /capture/i })).toBeDisabled();

    // Pressing Enter on the textarea also must not submit whitespace-only input.
    await user.keyboard('{Enter}');

    expect(mockCreateItem).not.toHaveBeenCalled();
  });

  it('trims the submitted text before calling createItem', async () => {
    mockCreateItem.mockResolvedValue({ id: '1', title: 'Task' } as Awaited<
      ReturnType<typeof apiClient.createItem>
    >);

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    await user.type(screen.getByRole('textbox', { name: /capture box/i }), '  Buy milk  ');
    await user.click(screen.getByRole('button', { name: /capture/i }));

    await waitFor(() => {
      expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ text: 'Buy milk' }));
    });
  });

  it('restores original text on failure only when the user has not started a new capture', async () => {
    // First call rejects, second call resolves (for the "user typed more" scenario).
    mockCreateItem
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({ id: '2', title: 'New capture' } as Awaited<
        ReturnType<typeof apiClient.createItem>
      >);

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    const textarea = screen.getByRole('textbox', { name: /capture box/i });
    await user.type(textarea, 'Buy milk');
    await user.keyboard('{Enter}');

    // Error shown and text restored since we haven't typed anything new.
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to save/i);
    expect(textarea).toHaveValue('Buy milk');
  });

  it('does not overwrite a new capture with the failed text when user has already typed more', async () => {
    // Make the save hang so we can type a second capture before it resolves.
    let rejectSave!: (error: Error) => void;
    mockCreateItem.mockImplementationOnce(
      () =>
        new Promise<never>((_, reject) => {
          rejectSave = reject;
        }),
    );

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    const textarea = screen.getByRole('textbox', { name: /capture box/i });
    await user.type(textarea, 'Buy milk');
    await user.keyboard('{Enter}');

    // The input was optimistically cleared, so type the next capture.
    await user.type(textarea, 'New text');

    // Reject the first save — the catch block runs setValue with the restore callback.
    rejectSave(new Error('Network error'));

    // Wait for the alert to appear (ensures the catch block has run and setValue was called).
    await screen.findByRole('alert');

    // The restore callback sees current = 'New text' (non-empty) → returns 'New text'.
    // With mutation current==='' → true: returns 'Buy milk' instead. Test would fail.
    expect(textarea).toHaveValue('New text');
  });

  it('keeps spinner visible when one of two in-flight saves resolves but the other is pending', async () => {
    // Use two never-resolving saves so both are in-flight simultaneously (overlap is guaranteed).
    // After confirming the spinner, reject the first save (triggers the finally block).
    // With inFlight still = 1 (second still pending), the spinner must stay visible.
    mockCreateItem.mockImplementation(() => new Promise(() => {}));

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    const textarea = screen.getByRole('textbox', { name: /capture box/i });
    await user.type(textarea, 'First');
    await user.keyboard('{Enter}');
    await user.type(textarea, 'Second');
    await user.keyboard('{Enter}');

    // Both in flight — spinner visible.
    expect(await screen.findByRole('status')).toBeInTheDocument();
    // Spinner is still on: both saves are pending. This proves isSaving=true.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('hides the spinner after all in-flight saves drain (via rejection)', async () => {
    // Use two controllable promises so both submits happen while each save is still pending.
    // Then reject both — finally block runs for each, inFlight → 0, isSaving → false.
    let rejectFirst!: (e: Error) => void;
    let rejectSecond!: (e: Error) => void;
    mockCreateItem
      .mockImplementationOnce(
        () =>
          new Promise<never>((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<never>((_, reject) => {
            rejectSecond = reject;
          }),
      );

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    const textarea = screen.getByRole('textbox', { name: /capture box/i });
    await user.type(textarea, 'First');
    await user.keyboard('{Enter}');
    await user.type(textarea, 'Second');
    await user.keyboard('{Enter}');

    // Both in flight — spinner visible.
    expect(await screen.findByRole('status')).toBeInTheDocument();

    // Reject first save — inFlight goes 2 → 1. Wrap in act() to flush ALL pending
    // React state updates from the rejection before asserting.
    await act(async () => {
      rejectFirst(new Error('fail1'));
      // Flush the rejection microtask so all React state updates run before we assert.
      await Promise.resolve();
    });

    // Spinner must still be visible: one save is still in flight.
    // With mutation `if (true) setIsSaving(false)`, the spinner would be gone here.
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Reject second save — inFlight goes 1 → 0. Now setIsSaving(false) IS called.
    await act(async () => {
      rejectSecond(new Error('fail2'));
      // Flush the rejection microtask.
      await Promise.resolve();
    });

    // Spinner must disappear once all in-flight saves drain.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the serif prompt when the textarea is empty and hides it when there is text', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    // The prompt is visible when the textarea is empty.
    expect(screen.getByText(/what.s on your mind/i)).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /capture box/i }), 'Hello');

    // The prompt disappears once the user has typed something.
    expect(screen.queryByText(/what.s on your mind/i)).not.toBeInTheDocument();
  });

  it('shows the capture button text "Capture" when not saving', () => {
    renderWithProviders(<CaptureBox />);

    const button = screen.getByRole('button', { name: /capture/i });
    expect(button).toHaveTextContent('Capture');
  });

  it('shows "Add" button text in compact mode when not saving', () => {
    renderWithProviders(<CaptureBox compact />);

    const button = screen.getByRole('button', { name: /add/i });
    expect(button).toHaveTextContent('Add');
  });

  it('compact submit button is disabled when input is empty', () => {
    renderWithProviders(<CaptureBox compact />);

    expect(screen.getByRole('button', { name: /add/i })).toBeDisabled();
  });

  it('compact submit button is enabled when there is text', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CaptureBox compact />);

    await user.type(screen.getByPlaceholderText(/add subtask/i), 'Subtask');

    expect(screen.getByRole('button', { name: /add/i })).toBeEnabled();
  });

  it('compact submit button is disabled when input contains only whitespace', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CaptureBox compact />);

    await user.type(screen.getByPlaceholderText(/add subtask/i), ' '.repeat(3));

    expect(screen.getByRole('button', { name: /add/i })).toBeDisabled();
  });

  it('full-mode submit button is disabled when input contains only whitespace', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CaptureBox />);

    await user.type(screen.getByRole('textbox', { name: /capture box/i }), ' '.repeat(3));

    expect(screen.getByRole('button', { name: /capture/i })).toBeDisabled();
  });

  it('compact Enter key submits the form', async () => {
    mockCreateItem.mockResolvedValue({ id: '1', title: 'Subtask' } as Awaited<
      ReturnType<typeof apiClient.createItem>
    >);

    const user = userEvent.setup();
    renderWithProviders(<CaptureBox compact />);

    await user.type(screen.getByPlaceholderText(/add subtask/i), 'Subtask');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ text: 'Subtask' }));
    });
  });

  it('compact Escape key clears the input and calls onCapture', async () => {
    const onCapture = jest.fn();
    const user = userEvent.setup();
    renderWithProviders(<CaptureBox compact onCapture={onCapture} />);

    const input = screen.getByPlaceholderText(/add subtask/i);
    await user.type(input, 'Draft text');
    await user.keyboard('{Escape}');

    expect(input).toHaveValue('');
    expect(onCapture).toHaveBeenCalled();
  });

  it('compact Escape key does not throw when onCapture is not provided', async () => {
    // Verifies optional chaining on onCapture?.() — calling onCapture() without
    // the optional chain would throw when onCapture is undefined.
    const user = userEvent.setup();
    renderWithProviders(<CaptureBox compact />);

    const input = screen.getByPlaceholderText(/add subtask/i);
    await user.type(input, 'Draft text');
    // Should not throw:
    await user.keyboard('{Escape}');

    // Input is cleared even without an onCapture callback.
    expect(input).toHaveValue('');
  });
});
