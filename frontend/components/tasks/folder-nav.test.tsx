import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';
import type { Folder } from '@/lib/types';

import { FolderNav } from './folder-nav';

// Mock next/navigation
const mockPathname = jest.fn<string, []>(() => '/');
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter() {
    return { push: mockPush };
  },
}));

// ViewLink switches views via window.history.pushState; stub it so clicks in jsdom
// don't mutate the shared history. restoreMocks resets spies per test, so re-spy each.
beforeEach(() => {
  jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
});

// Mock api-client
jest.mock('@/lib/api-client');
const mockCreateFolder = jest.mocked(apiClient.createFolder);
const mockUpdateFolder = jest.mocked(apiClient.updateFolder);
const mockDeleteFolder = jest.mocked(apiClient.deleteFolder);

const FOLDERS: Folder[] = [
  { id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z' },
  { id: 'f2', name: 'Personal', created_at: '2025-01-02T00:00:00Z' },
];

describe('FolderNav', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname.mockReturnValue('/');
  });

  it('renders Inbox, Completed links, and folder names', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /inbox/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /completed/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /work/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /personal/i })).toBeInTheDocument();
  });

  it('renders with no folders when the list is empty', () => {
    renderWithProviders(<FolderNav />, { folders: [] });

    expect(screen.getByRole('link', { name: /inbox/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /work/i })).not.toBeInTheDocument();
  });

  it('does not show the folder create form initially', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.queryByPlaceholderText(/folder name/i)).not.toBeInTheDocument();
  });

  it('shows the new folder form when the create button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));

    expect(screen.getByPlaceholderText(/folder name/i)).toBeInTheDocument();
  });

  it('save folder button is disabled when folder name is empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));

    expect(screen.getByRole('button', { name: /save folder/i })).toBeDisabled();
  });

  it('save folder button is disabled when folder name contains only whitespace', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), ' '.repeat(3));

    expect(screen.getByRole('button', { name: /save folder/i })).toBeDisabled();
  });

  it('save folder button is enabled when folder name has text', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');

    expect(screen.getByRole('button', { name: /save folder/i })).not.toBeDisabled();
  });

  it('adds a folder optimistically and calls createFolder', async () => {
    mockCreateFolder.mockResolvedValue({
      id: 'f3',
      name: 'Projects',
      created_at: '2025-01-03T00:00:00Z',
    });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
    await user.click(screen.getByRole('button', { name: /save folder/i }));

    // The store updates the list immediately — no router.refresh().
    expect(await screen.findByRole('link', { name: /projects/i })).toBeInTheDocument();
    expect(mockCreateFolder).toHaveBeenCalledWith('Projects');
  });

  it('hides the create form and clears the name after successful creation', async () => {
    mockCreateFolder.mockResolvedValue({
      id: 'f3',
      name: 'Projects',
      created_at: '2025-01-03T00:00:00Z',
    });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
    await user.click(screen.getByRole('button', { name: /save folder/i }));

    // After success the form should be gone
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/folder name/i)).not.toBeInTheDocument();
    });
  });

  it('reopening the create form after success shows an empty input', async () => {
    mockCreateFolder.mockResolvedValue({
      id: 'f3',
      name: 'Projects',
      created_at: '2025-01-03T00:00:00Z',
    });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
    await user.click(screen.getByRole('button', { name: /save folder/i }));

    // Wait for form to close
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/folder name/i)).not.toBeInTheDocument();
    });

    // Reopen — input should be empty (name was cleared on success)
    await user.click(screen.getByRole('button', { name: /create folder/i }));
    expect(screen.getByPlaceholderText(/folder name/i)).toHaveValue('');
  });

  it('keeps the create form open when createFolder fails', async () => {
    mockCreateFolder.mockRejectedValue(new Error('Network error'));

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
    await user.click(screen.getByRole('button', { name: /save folder/i }));

    // Form should remain open so the user can retry
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/folder name/i)).toBeInTheDocument();
    });
  });

  it('does not call createFolder when folder name is only whitespace (via Enter)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    // Type spaces into the input and submit via Enter (bypasses disabled button)
    await user.type(screen.getByPlaceholderText(/folder name/i), ' '.repeat(3));
    await user.keyboard('{Enter}');

    expect(mockCreateFolder).not.toHaveBeenCalled();
  });

  it('does not create a folder when the form is submitted directly with an empty name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));

    // Submit the form directly (bypassing the disabled submit button) with an empty
    // name. The empty-name guard must early-return before addFolder/createFolder runs.
    const form = screen.getByPlaceholderText(/folder name/i).closest('form');
    if (!form) throw new Error('expected the create form to be in the document');
    fireEvent.submit(form);

    expect(mockCreateFolder).not.toHaveBeenCalled();
  });

  it('calls createFolder with the trimmed name when input has surrounding spaces', async () => {
    mockCreateFolder.mockResolvedValue({
      id: 'f3',
      name: 'Projects',
      created_at: '2025-01-03T00:00:00Z',
    });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), '  Projects  ');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith('Projects');
    });
  });

  it('save folder button is disabled while createFolder is in flight', async () => {
    // Never-resolving promise to hold the in-flight state
    mockCreateFolder.mockImplementation(() => new Promise<never>(() => {}));

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
    await user.click(screen.getByRole('button', { name: /save folder/i }));

    // While the promise is pending the save button should be disabled
    expect(screen.getByRole('button', { name: /save folder/i })).toBeDisabled();
  });

  it('can rename a folder after a create completes (isPending resets to false after create)', async () => {
    mockCreateFolder.mockResolvedValue({
      id: 'f3',
      name: 'Projects',
      created_at: '2025-01-03T00:00:00Z',
    });
    mockUpdateFolder.mockResolvedValue({
      id: 'f1',
      name: 'Work Renamed',
      created_at: '2025-01-01T00:00:00Z',
    });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    // Create a folder and wait for it to complete
    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
    await user.click(screen.getByRole('button', { name: /save folder/i }));
    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith('Projects');
    });

    // Now rename Work — should succeed since isPending reset to false
    await user.click(screen.getByRole('button', { name: /rename work/i }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Work Renamed');
    await user.click(screen.getByRole('button', { name: /save rename/i }));

    await waitFor(() => {
      expect(mockUpdateFolder).toHaveBeenCalledWith('f1', 'Work Renamed');
    });
  });

  it('dismisses the create form on Escape key without calling createFolder', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Draft');
    await user.keyboard('{Escape}');

    expect(screen.queryByPlaceholderText(/folder name/i)).not.toBeInTheDocument();
    expect(mockCreateFolder).not.toHaveBeenCalled();
  });

  it('clears the folder name when Escape dismisses the create form (reopening shows empty input)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    // Open, type, then dismiss with Escape
    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Draft');
    await user.keyboard('{Escape}');

    // Reopen — input should be empty
    await user.click(screen.getByRole('button', { name: /create folder/i }));
    expect(screen.getByPlaceholderText(/folder name/i)).toHaveValue('');
  });

  it('calls onClose when a nav link is clicked and onClose is provided', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    renderWithProviders(<FolderNav onClose={onClose} />, { folders: FOLDERS });

    await user.click(screen.getByRole('link', { name: /inbox/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when no onClose prop is given', () => {
    // Renders without throwing and links are still present
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /inbox/i })).toBeInTheDocument();
  });

  it('inbox link points to /?view=inbox', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /inbox/i })).toHaveAttribute('href', '/?view=inbox');
  });

  it('completed link points to /completed', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /completed/i })).toHaveAttribute('href', '/completed');
  });

  it('folder links point to /folders/<id>', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /work/i })).toHaveAttribute('href', '/folders/f1');
    expect(screen.getByRole('link', { name: /personal/i })).toHaveAttribute('href', '/folders/f2');
  });

  it('highlights the inbox link when on the / route', () => {
    mockPathname.mockReturnValue('/');
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /inbox/i })).toHaveClass('bg-secondary');
    expect(screen.getByRole('link', { name: /completed/i })).not.toHaveClass('bg-secondary');
    // Inactive links use the muted foreground class
    expect(screen.getByRole('link', { name: /completed/i })).toHaveClass('text-muted-foreground');
  });

  it('highlights the completed link when on /completed route', () => {
    mockPathname.mockReturnValue('/completed');
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /completed/i })).toHaveClass('bg-secondary');
    expect(screen.getByRole('link', { name: /inbox/i })).not.toHaveClass('bg-secondary');
  });

  it('highlights the folder link for the active folder route', () => {
    mockPathname.mockReturnValue('/folders/f1');
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /work/i })).toHaveClass('bg-secondary');
    expect(screen.getByRole('link', { name: /personal/i })).not.toHaveClass('bg-secondary');
  });

  it('does not highlight any folder link when on an unrelated route', () => {
    mockPathname.mockReturnValue('/settings');
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /inbox/i })).not.toHaveClass('bg-secondary');
    expect(screen.getByRole('link', { name: /completed/i })).not.toHaveClass('bg-secondary');
    expect(screen.getByRole('link', { name: /work/i })).not.toHaveClass('bg-secondary');
  });

  it('calls deleteFolder when the delete button is clicked for a folder', async () => {
    mockDeleteFolder.mockResolvedValue({ success: true });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /delete work/i }));

    // Optimistic removal — the folder vanishes from the nav immediately.
    expect(screen.queryByRole('link', { name: /work/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockDeleteFolder).toHaveBeenCalledWith('f1');
    });
  });

  it('does not navigate away after deleting a non-active folder', async () => {
    mockDeleteFolder.mockResolvedValue({ success: true });
    mockPathname.mockReturnValue('/folders/f2');

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /delete work/i }));

    await waitFor(() => {
      expect(mockDeleteFolder).toHaveBeenCalledWith('f1');
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('navigates to / after deleting the currently active folder', async () => {
    mockDeleteFolder.mockResolvedValue({ success: true });
    mockPathname.mockReturnValue('/folders/f1');

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /delete work/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('does not navigate away when deleteFolder fails on the active folder', async () => {
    mockDeleteFolder.mockRejectedValue(new Error('Server error'));
    mockPathname.mockReturnValue('/folders/f1');

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /delete work/i }));

    await waitFor(() => {
      expect(mockDeleteFolder).toHaveBeenCalledWith('f1');
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('create form save button is disabled while a delete is in flight', async () => {
    // Never-resolving promise so delete stays in flight
    mockDeleteFolder.mockImplementation(() => new Promise<never>(() => {}));

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    // Start the delete operation (folder is removed optimistically from UI immediately)
    await user.click(screen.getByRole('button', { name: /delete personal/i }));

    // Open the create form while delete is in flight
    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');

    // Save button should be disabled because isPending = true
    expect(screen.getByRole('button', { name: /save folder/i })).toBeDisabled();
  });

  it('ignores a delete click while another action is in flight (shared isPending guard)', async () => {
    // Hold the create in-flight via a deferred promise so isPending stays true. The
    // Promise executor runs synchronously, so `resolveCreate` is assigned before use.
    const deferred = {} as { resolve: (folder: Folder) => void };
    mockCreateFolder.mockImplementation(
      () =>
        new Promise<Folder>((resolve) => {
          deferred.resolve = resolve;
        }),
    );

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    // Kick off a create that never resolves yet → component isPending becomes true.
    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
    await user.click(screen.getByRole('button', { name: /save folder/i }));

    // createFolder is in flight; isPending is true.
    expect(mockCreateFolder).toHaveBeenCalledWith('Projects');

    // The delete IconButton has no `disabled` prop, so the click fires; only the
    // handleDeleteFolder isPending guard blocks it. With the guard intact,
    // removeFolder/deleteFolder must NOT be called while the create is pending.
    await user.click(screen.getByRole('button', { name: /delete work/i }));
    expect(mockDeleteFolder).not.toHaveBeenCalled();

    // Cleanup: resolve the pending create to avoid trailing act() warnings.
    deferred.resolve({ id: 'f3', name: 'Projects', created_at: '2025-01-03T00:00:00Z' });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /projects/i })).toBeInTheDocument();
    });
  });

  it('can create a folder after a delete completes (isPending resets to false after delete)', async () => {
    mockDeleteFolder.mockResolvedValue({ success: true });
    mockCreateFolder.mockResolvedValue({
      id: 'f3',
      name: 'Projects',
      created_at: '2025-01-03T00:00:00Z',
    });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    // Delete a folder and wait for it to complete
    await user.click(screen.getByRole('button', { name: /delete personal/i }));
    await waitFor(() => {
      expect(mockDeleteFolder).toHaveBeenCalledWith('f2');
    });

    // Now create a folder — should work since isPending reset to false
    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
    await user.click(screen.getByRole('button', { name: /save folder/i }));

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith('Projects');
    });
  });

  it('shows the rename form when the rename button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /rename work/i }));

    // The rename input appears (folder link is replaced)
    expect(screen.queryByRole('link', { name: /work/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save rename/i })).toBeInTheDocument();
  });

  it('pre-fills the rename input with the current folder name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /rename work/i }));

    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('Work');
  });

  it('calls updateFolder with the new name when the rename form is submitted', async () => {
    mockUpdateFolder.mockResolvedValue({
      id: 'f1',
      name: 'Work Renamed',
      created_at: '2025-01-01T00:00:00Z',
    });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /rename work/i }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Work Renamed');
    await user.click(screen.getByRole('button', { name: /save rename/i }));

    await waitFor(() => {
      expect(mockUpdateFolder).toHaveBeenCalledWith('f1', 'Work Renamed');
    });
  });

  it('hides the rename form after a successful rename', async () => {
    mockUpdateFolder.mockResolvedValue({
      id: 'f1',
      name: 'Work Renamed',
      created_at: '2025-01-01T00:00:00Z',
    });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /rename work/i }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Work Renamed');
    await user.click(screen.getByRole('button', { name: /save rename/i }));

    // After success the rename form should be gone, new name appears as a link
    expect(await screen.findByRole('link', { name: /work renamed/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save rename/i })).not.toBeInTheDocument();
  });

  it('does not call updateFolder when rename name is empty/whitespace', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /rename work/i }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /save rename/i }));

    expect(mockUpdateFolder).not.toHaveBeenCalled();
  });

  it('updates the rename input as the user types', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /rename work/i }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'New Name');

    expect(input).toHaveValue('New Name');
  });

  it('dismisses the rename form on Escape key', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /rename work/i }));
    expect(screen.getByRole('button', { name: /save rename/i })).toBeInTheDocument();

    // Click the input to focus it, then press Escape so onKeyDown fires
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Escape}');

    // Rename form hidden, folder link reappears
    expect(screen.queryByRole('button', { name: /save rename/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /work/i })).toBeInTheDocument();
  });

  it('rename button label includes folder name for accessibility', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('button', { name: /rename work/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rename personal/i })).toBeInTheDocument();
  });

  it('only shows the rename form for the clicked folder, not others', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /rename work/i }));

    // Work is in editing mode (no link), Personal stays as a link
    expect(screen.queryByRole('link', { name: /work/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /personal/i })).toBeInTheDocument();
  });

  it('keeps the rename form open when updateFolder fails', async () => {
    mockUpdateFolder.mockRejectedValue(new Error('Server error'));

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /rename work/i }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Work Renamed');
    await user.click(screen.getByRole('button', { name: /save rename/i }));

    // On failure, the rename form should still be visible for retry
    await waitFor(() => {
      expect(mockUpdateFolder).toHaveBeenCalledWith('f1', 'Work Renamed');
    });
    // The form remains open after the failed rename
    expect(screen.queryByRole('button', { name: /save rename/i })).toBeInTheDocument();
  });

  it('save rename button is disabled while updateFolder is in flight', async () => {
    // Never-resolving promise to hold the in-flight state
    mockUpdateFolder.mockImplementation(() => new Promise<never>(() => {}));

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /rename work/i }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Work Renamed');
    await user.click(screen.getByRole('button', { name: /save rename/i }));

    // While the promise is pending the save rename button should be disabled
    expect(screen.getByRole('button', { name: /save rename/i })).toBeDisabled();
  });

  it('can create a folder after a rename completes (isPending resets to false after rename)', async () => {
    mockUpdateFolder.mockResolvedValue({
      id: 'f1',
      name: 'Work Renamed',
      created_at: '2025-01-01T00:00:00Z',
    });
    mockCreateFolder.mockResolvedValue({
      id: 'f3',
      name: 'Projects',
      created_at: '2025-01-03T00:00:00Z',
    });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    // Rename a folder and wait for it to complete
    await user.click(screen.getByRole('button', { name: /rename work/i }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Work Renamed');
    await user.click(screen.getByRole('button', { name: /save rename/i }));
    await waitFor(() => {
      expect(mockUpdateFolder).toHaveBeenCalledWith('f1', 'Work Renamed');
    });

    // Now create a folder — should succeed since isPending reset to false
    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
    await user.click(screen.getByRole('button', { name: /save folder/i }));

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith('Projects');
    });
  });

  it('does not call updateFolder when rename name is only whitespace (via Enter)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /rename work/i }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, ' '.repeat(3));
    await user.keyboard('{Enter}');

    expect(mockUpdateFolder).not.toHaveBeenCalled();
  });

  it('calls updateFolder with the trimmed name when rename input has surrounding spaces', async () => {
    mockUpdateFolder.mockResolvedValue({
      id: 'f1',
      name: 'Work Renamed',
      created_at: '2025-01-01T00:00:00Z',
    });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /rename work/i }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, '  Work Renamed  ');
    await user.click(screen.getByRole('button', { name: /save rename/i }));

    await waitFor(() => {
      expect(mockUpdateFolder).toHaveBeenCalledWith('f1', 'Work Renamed');
    });
  });

  it('nav has aria-label Navigation', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('navigation', { name: /navigation/i })).toBeInTheDocument();
  });

  it('does not call onClose when onClose prop is absent and folder link is clicked', () => {
    // No onClose — should render without error, no onClick on links
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    // The link should still be rendered and functional (no onClick side-effect)
    const workLink = screen.getByRole('link', { name: /work/i });
    expect(workLink).toBeInTheDocument();
  });

  it('folder nav contains a Folders section heading', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByText(/folders/i)).toBeInTheDocument();
  });

  it('within folder row, delete button has accessible label for the folder', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('button', { name: /delete work/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete personal/i })).toBeInTheDocument();
  });

  describe('rename form submit via keyboard', () => {
    it('submits rename on Enter key', async () => {
      mockUpdateFolder.mockResolvedValue({
        id: 'f1',
        name: 'Work Renamed',
        created_at: '2025-01-01T00:00:00Z',
      });

      const user = userEvent.setup();
      renderWithProviders(<FolderNav />, { folders: FOLDERS });

      await user.click(screen.getByRole('button', { name: /rename work/i }));
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'Work Renamed');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(mockUpdateFolder).toHaveBeenCalledWith('f1', 'Work Renamed');
      });
    });
  });

  describe('create form submit via keyboard', () => {
    it('submits create on Enter key', async () => {
      mockCreateFolder.mockResolvedValue({
        id: 'f3',
        name: 'Projects',
        created_at: '2025-01-03T00:00:00Z',
      });

      const user = userEvent.setup();
      renderWithProviders(<FolderNav />, { folders: FOLDERS });

      await user.click(screen.getByRole('button', { name: /create folder/i }));
      await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(mockCreateFolder).toHaveBeenCalledWith('Projects');
      });
    });
  });
});
