import { screen, waitFor } from '@testing-library/react';
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
});
