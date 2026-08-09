import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { pinClock } from '@/lib/pin-clock';
import { renderWithProviders } from '@/lib/test-utils';
import type { Folder, Item } from '@/lib/types';

import { FolderNav } from './folder-nav';

pinClock('2026-07-28T12:00:00.000Z');

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
  { description: null, id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z', sort_order: 10 },
  {
    description: null,
    id: 'f2',
    name: 'Personal',
    created_at: '2025-01-02T00:00:00Z',
    sort_order: 20,
  },
];

/** A local YYYY-MM-DD due-date string offset from today (0 = today, -1 = yesterday). */
const dueYMD = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Fixed residency stamp for a seeded FILED item — fixtures pin the clock, never read it. */
const DISPATCHED_AT = '2025-01-02T00:00:00Z';

/** Minimal active task item for seeding the store in due-count tests. */
const taskItem = (overrides: Partial<Item>): Item => ({
  id: 'i1',
  title: 'Task',
  notes: null,
  source_url: null,
  item_type: 'task',
  created_at: '2025-01-01T00:00:00Z',
  raw_capture: null,
  due_date: null,
  status: 'active',
  completed_at: null,
  folder_id: null,
  // A fixture with a folder is a filed item, so it defaults to dispatched. `...overrides` lands
  // last, so a fixture can still state `dispatched_at: null` for a foldered Inbox item.
  dispatched_at: overrides.folder_id == null ? null : DISPATCHED_AT,
  parent_id: null,
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
  intended_epic_id: null,
  sort_order: 0,
  classified_at: null,
  classified_provider: null,
  classified_model: null,
  classified_prompt_version: null,
  classified_guess: null,
  classify_attempts: 0,
  ...overrides,
});

// Opens the options dropdown for the named folder and waits for the menu to appear.
// Radix DropdownMenu portals set pointer-events:none on the body, so subsequent item
// interactions must use keyboard navigation — see selectEdit / selectDelete below.
const openFolderMenu = async (user: ReturnType<typeof userEvent.setup>, folderName: string) => {
  await user.click(
    screen.getByRole('button', { name: new RegExp(`options for ${folderName}`, 'i') }),
  );
  await screen.findByRole('menu');
};

// Walks the open menu with ArrowDown until the named item is focused, then activates it.
// The entry list varies per row — "Move up" / "Move down" appear only where the folder can
// travel — so items are reached by name rather than by a fixed number of key presses.
const selectMenuItem = async (user: ReturnType<typeof userEvent.setup>, name: string | RegExp) => {
  const item = screen.getByRole('menuitem', { name });
  const menuLength = screen.getAllByRole('menuitem').length;
  for (let step = 0; step < menuLength && document.activeElement !== item; step += 1) {
    await user.keyboard('[ArrowDown]');
  }
  await user.keyboard('[Enter]');
};

/** The folder names in the order the sidebar renders them. */
const renderedFolders = () =>
  screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('href')?.startsWith('/folders/'))
    .map((link) => link.textContent);

// Selects "Edit" from the currently open folder menu.
const selectEdit = async (user: ReturnType<typeof userEvent.setup>) => {
  await selectMenuItem(user, 'Edit');
};

// Selects "Delete" (below the separator) from the currently open folder menu.
const selectDelete = async (user: ReturnType<typeof userEvent.setup>) => {
  await selectMenuItem(user, 'Delete');
};

describe('FolderNav', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname.mockReturnValue('/');
  });

  it('renders the Completed link and folder names', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /completed/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /work/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /personal/i })).toBeInTheDocument();
  });

  it('lets the folder link flex-fill the row so the truncating name has room', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /work/i })).toHaveClass('flex-1', 'min-w-0');
  });

  it('does NOT render an Inbox link (removed; reach the inbox via the wordmark)', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.queryByRole('link', { name: /inbox/i })).not.toBeInTheDocument();
  });

  it('renders with no folders when the list is empty', () => {
    renderWithProviders(<FolderNav />, { folders: [] });

    expect(screen.getByRole('link', { name: /completed/i })).toBeInTheDocument();
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
      description: null,
      id: 'f3',
      name: 'Projects',
      created_at: '2025-01-03T00:00:00Z',
      sort_order: 30,
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
      description: null,
      id: 'f3',
      name: 'Projects',
      created_at: '2025-01-03T00:00:00Z',
      sort_order: 30,
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
      description: null,
      id: 'f3',
      name: 'Projects',
      created_at: '2025-01-03T00:00:00Z',
      sort_order: 30,
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
      description: null,
      id: 'f3',
      name: 'Projects',
      created_at: '2025-01-03T00:00:00Z',
      sort_order: 30,
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

  it('closes the create form immediately before the API resolves', async () => {
    mockCreateFolder.mockImplementation(() => new Promise<never>(() => {}));

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
    await user.click(screen.getByRole('button', { name: /save folder/i }));

    // Form closes immediately — no waitFor needed
    expect(screen.queryByPlaceholderText(/folder name/i)).not.toBeInTheDocument();
  });

  it('shows the new folder in the list immediately before the API resolves', async () => {
    mockCreateFolder.mockImplementation(() => new Promise<never>(() => {}));

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
    await user.click(screen.getByRole('button', { name: /save folder/i }));

    // Folder appears immediately via the optimistic store dispatch
    expect(screen.getByRole('link', { name: /projects/i })).toBeInTheDocument();
  });

  it('restores the create form with the original name when createFolder fails', async () => {
    mockCreateFolder.mockRejectedValue(new Error('Network error'));

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
    await user.click(screen.getByRole('button', { name: /save folder/i }));

    // Form re-opens with the original name so the user can retry
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/folder name/i)).toHaveValue('Projects');
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

  it('focuses the create-folder input immediately on open', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));

    expect(screen.getByPlaceholderText(/folder name/i)).toHaveFocus();
  });

  it('dismisses the create form when clicking outside it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    expect(screen.getByPlaceholderText(/folder name/i)).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /completed/i }));

    expect(screen.queryByPlaceholderText(/folder name/i)).not.toBeInTheDocument();
    expect(mockCreateFolder).not.toHaveBeenCalled();
  });

  it('clears the name when dismissing the create form by clicking outside (reopening shows empty input)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Draft');

    await user.click(screen.getByRole('link', { name: /completed/i }));

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    expect(screen.getByPlaceholderText(/folder name/i)).toHaveValue('');
  });

  it('does not dismiss the create form when clicking inside it on the input', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.click(screen.getByPlaceholderText(/folder name/i));

    expect(screen.getByPlaceholderText(/folder name/i)).toBeInTheDocument();
  });

  it('calls onClose when a nav link is clicked and onClose is provided', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    renderWithProviders(<FolderNav onClose={onClose} />, { folders: FOLDERS });

    await user.click(screen.getByRole('link', { name: /completed/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when no onClose prop is given', () => {
    // Renders without throwing and links are still present
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /completed/i })).toBeInTheDocument();
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

  it('renders a Priority link pointing to /priority', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /priority/i })).toHaveAttribute('href', '/priority');
  });

  it('renders a Week Plan link pointing to /plan, directly under Priority', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /week plan/i })).toHaveAttribute('href', '/plan');

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs.indexOf('/plan')).toBe(hrefs.indexOf('/priority') + 1);
    expect(hrefs.indexOf('/plan')).toBeLessThan(hrefs.indexOf('/folders/f1'));
  });

  it('renders a Habits link pointing to /habits, directly under Week Plan', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /habits/i })).toHaveAttribute('href', '/habits');

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs.indexOf('/habits')).toBe(hrefs.indexOf('/plan') + 1);
    expect(hrefs.indexOf('/habits')).toBeLessThan(hrefs.indexOf('/folders/f1'));
  });

  it('shows no habit badge when nothing is outstanding today', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.queryByLabelText(/not logged today/)).not.toBeInTheDocument();
  });

  it('counts today’s applicable-but-unlogged habits on the Habits link', () => {
    renderWithProviders(<FolderNav />, {
      folders: FOLDERS,
      habits: {
        habits: [
          {
            id: 'habit-1',
            name: 'Morning routine',
            notes: null,
            criteria: [{ key: 'light', label: 'Outside', kind: 'boolean' }],
            active_days: [1, 2, 3, 4, 5, 6, 7],
            allowance: 1,
            started_on: '2026-07-01',
            archived_at: null,
            sort_order: null,
            created_at: '2026-07-01T00:00:00Z',
          },
        ],
        entries: [],
        today: '2026-07-28',
      },
    });

    expect(screen.getByLabelText('1 not logged today')).toHaveTextContent('1');
  });

  it('highlights the Week Plan link when on /plan', () => {
    mockPathname.mockReturnValue('/plan');
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /week plan/i })).toHaveClass('bg-secondary');
    expect(screen.getByRole('link', { name: 'Priority' })).not.toHaveClass('bg-secondary');
  });

  it('renders the Priority link above the folders', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    const priorityIndex = hrefs.indexOf('/priority');
    const firstFolderIndex = hrefs.indexOf('/folders/f1');
    expect(priorityIndex).toBeGreaterThanOrEqual(0);
    expect(priorityIndex).toBeLessThan(firstFolderIndex);
  });

  it('renders the Priority link above the Completed link', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs.indexOf('/priority')).toBeLessThan(hrefs.indexOf('/completed'));
  });

  it('highlights the priority link when on /priority route', () => {
    mockPathname.mockReturnValue('/priority');
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /priority/i })).toHaveClass('bg-secondary');
  });

  it('does not highlight Completed on the / route, and shows it muted', () => {
    mockPathname.mockReturnValue('/');
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    // The inbox is reached via the wordmark now — no nav link highlights on `/`.
    expect(screen.getByRole('link', { name: /completed/i })).not.toHaveClass('bg-secondary');
    // Inactive links use the muted foreground class
    expect(screen.getByRole('link', { name: /completed/i })).toHaveClass('text-muted-foreground');
  });

  it('highlights the completed link when on /completed route', () => {
    mockPathname.mockReturnValue('/completed');
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('link', { name: /completed/i })).toHaveClass('bg-secondary');
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

    expect(screen.getByRole('link', { name: /completed/i })).not.toHaveClass('bg-secondary');
    expect(screen.getByRole('link', { name: /work/i })).not.toHaveClass('bg-secondary');
  });

  it('calls deleteFolder when Delete is selected from the folder options menu', async () => {
    mockDeleteFolder.mockResolvedValue({ success: true });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectDelete(user);

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

    await openFolderMenu(user, 'Work');
    await selectDelete(user);

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

    await openFolderMenu(user, 'Work');
    await selectDelete(user);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('does not navigate away when deleteFolder fails on the active folder', async () => {
    mockDeleteFolder.mockRejectedValue(new Error('Server error'));
    mockPathname.mockReturnValue('/folders/f1');

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectDelete(user);

    await waitFor(() => {
      expect(mockDeleteFolder).toHaveBeenCalledWith('f1');
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows the rename form when Edit is selected from the folder options menu', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);

    // The rename input appears (folder link is replaced)
    expect(screen.queryByRole('link', { name: /work/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save rename/i })).toBeInTheDocument();
  });

  it('pre-fills the rename input with the current folder name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);

    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('Work');
  });

  it('calls updateFolder with the new name when the rename form is submitted', async () => {
    mockUpdateFolder.mockResolvedValue({
      description: null,
      id: 'f1',
      name: 'Work Renamed',
      created_at: '2025-01-01T00:00:00Z',
      sort_order: 10,
    });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Work Renamed');
    await user.click(screen.getByRole('button', { name: /save rename/i }));

    await waitFor(() => {
      expect(mockUpdateFolder).toHaveBeenCalledWith('f1', { name: 'Work Renamed' });
    });
  });

  it('hides the rename form after a successful rename', async () => {
    mockUpdateFolder.mockResolvedValue({
      description: null,
      id: 'f1',
      name: 'Work Renamed',
      created_at: '2025-01-01T00:00:00Z',
      sort_order: 10,
    });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);
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

    await openFolderMenu(user, 'Work');
    await selectEdit(user);
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /save rename/i }));

    expect(mockUpdateFolder).not.toHaveBeenCalled();
  });

  it('updates the rename input as the user types', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'New Name');

    expect(input).toHaveValue('New Name');
  });

  it('dismisses the rename form on Escape key', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);
    expect(screen.getByRole('button', { name: /save rename/i })).toBeInTheDocument();

    // Click the input to focus it, then press Escape so onKeyDown fires
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Escape}');

    // Rename form hidden, folder link reappears
    expect(screen.queryByRole('button', { name: /save rename/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /work/i })).toBeInTheDocument();
  });

  it('focuses the rename input immediately on open', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);

    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('dismisses the rename form when clicking outside it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);
    expect(screen.getByRole('button', { name: /save rename/i })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /completed/i }));

    expect(screen.queryByRole('button', { name: /save rename/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /work/i })).toBeInTheDocument();
    expect(mockUpdateFolder).not.toHaveBeenCalled();
  });

  it('does not dismiss the rename form when clicking inside it on the input', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);

    await user.click(screen.getByRole('textbox'));

    expect(screen.getByRole('button', { name: /save rename/i })).toBeInTheDocument();
  });

  it('options button label includes folder name for accessibility', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('button', { name: /options for work/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /options for personal/i })).toBeInTheDocument();
  });

  it('only shows the rename form for the clicked folder, not others', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);

    // Work is in editing mode (no link), Personal stays as a link
    expect(screen.queryByRole('link', { name: /work/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /personal/i })).toBeInTheDocument();
  });

  it('keeps the rename form open when updateFolder fails', async () => {
    mockUpdateFolder.mockRejectedValue(new Error('Server error'));

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Work Renamed');
    await user.click(screen.getByRole('button', { name: /save rename/i }));

    // On failure, the rename form should still be visible for retry
    await waitFor(() => {
      expect(mockUpdateFolder).toHaveBeenCalledWith('f1', { name: 'Work Renamed' });
    });
    // The form remains open after the failed rename
    expect(screen.queryByRole('button', { name: /save rename/i })).toBeInTheDocument();
  });

  it('closes the rename form immediately before the API resolves', async () => {
    mockUpdateFolder.mockImplementation(() => new Promise<never>(() => {}));

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Work Renamed');
    await user.click(screen.getByRole('button', { name: /save rename/i }));

    // Rename form closes immediately — no waitFor needed
    expect(screen.queryByRole('button', { name: /save rename/i })).not.toBeInTheDocument();
  });

  it('shows the updated name in the list immediately before the rename API resolves', async () => {
    mockUpdateFolder.mockImplementation(() => new Promise<never>(() => {}));

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Work Renamed');
    await user.click(screen.getByRole('button', { name: /save rename/i }));

    // Updated name appears immediately via the optimistic store patch
    expect(screen.getByRole('link', { name: /work renamed/i })).toBeInTheDocument();
  });

  it('does not call updateFolder when rename name is only whitespace (via Enter)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, ' '.repeat(3));
    await user.keyboard('{Enter}');

    expect(mockUpdateFolder).not.toHaveBeenCalled();
  });

  it('calls updateFolder with the trimmed name when rename input has surrounding spaces', async () => {
    mockUpdateFolder.mockResolvedValue({
      description: null,
      id: 'f1',
      name: 'Work Renamed',
      created_at: '2025-01-01T00:00:00Z',
      sort_order: 10,
    });

    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');
    await selectEdit(user);
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, '  Work Renamed  ');
    await user.click(screen.getByRole('button', { name: /save rename/i }));

    await waitFor(() => {
      expect(mockUpdateFolder).toHaveBeenCalledWith('f1', { name: 'Work Renamed' });
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

  it('within folder row, options button has accessible label for the folder', () => {
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    expect(screen.getByRole('button', { name: /options for work/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /options for personal/i })).toBeInTheDocument();
  });

  it('folder options menu contains Edit and Delete items', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FolderNav />, { folders: FOLDERS });

    await openFolderMenu(user, 'Work');

    expect(screen.getByRole('menuitem', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument();
  });

  describe('manual folder order', () => {
    // Deliberately seeded out of rank order: the store, not the seed array, decides the
    // sidebar's order.
    /** The only folder in the sidebar — it can travel in neither direction. */
    const LONE_FOLDER: Folder = {
      description: null,
      id: 'f1',
      name: 'Work',
      created_at: '2025-01-01T00:00:00Z',
      sort_order: 10,
    };

    const UNSORTED: Folder[] = [
      {
        description: null,
        id: 'f1',
        name: 'Work',
        created_at: '2025-01-01T00:00:00Z',
        sort_order: 30,
      },
      {
        description: null,
        id: 'f2',
        name: 'Personal',
        created_at: '2025-01-02T00:00:00Z',
        sort_order: 10,
      },
      {
        description: null,
        id: 'f3',
        name: 'Someday',
        created_at: '2025-01-03T00:00:00Z',
        sort_order: 20,
      },
    ];

    it('renders the folders by their manual rank, not the order they were seeded in', () => {
      renderWithProviders(<FolderNav />, { folders: UNSORTED });

      expect(renderedFolders()).toStrictEqual(['Personal', 'Someday', 'Work']);
    });

    it('hides Move up on the first folder and Move down on the last', async () => {
      const user = userEvent.setup();
      renderWithProviders(<FolderNav />, { folders: FOLDERS });

      await openFolderMenu(user, 'Work');
      expect(screen.queryByRole('menuitem', { name: 'Move up' })).not.toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeInTheDocument();
      await user.keyboard('{Escape}');

      await openFolderMenu(user, 'Personal');
      expect(screen.queryByRole('menuitem', { name: 'Move down' })).not.toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeInTheDocument();
    });

    it('offers neither move entry when a lone folder has nowhere to go', async () => {
      const user = userEvent.setup();
      renderWithProviders(<FolderNav />, { folders: [LONE_FOLDER] });

      await openFolderMenu(user, 'Work');

      expect(screen.queryByRole('menuitem', { name: 'Move up' })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Move down' })).not.toBeInTheDocument();
    });

    it('Move down swaps the folder past the one below it, ranking it beyond that neighbour', async () => {
      mockUpdateFolder.mockImplementation(() => new Promise<never>(() => {}));
      const user = userEvent.setup();
      renderWithProviders(<FolderNav />, { folders: FOLDERS });

      await openFolderMenu(user, 'Work');
      await selectMenuItem(user, 'Move down');

      // Below "Personal" (20) with nothing after it → one rank past that edge.
      expect(mockUpdateFolder).toHaveBeenCalledWith('f1', { sort_order: 21 });
      // The list re-sorts immediately, without waiting on the server.
      expect(renderedFolders()).toStrictEqual(['Personal', 'Work']);
    });

    it('Move up lands the folder at the midpoint above its neighbour', async () => {
      mockUpdateFolder.mockImplementation(() => new Promise<never>(() => {}));
      const user = userEvent.setup();
      renderWithProviders(<FolderNav />, {
        folders: [
          ...FOLDERS,
          {
            description: null,
            id: 'f3',
            name: 'Someday',
            created_at: '2025-01-03T00:00:00Z',
            sort_order: 30,
          },
        ],
      });

      await openFolderMenu(user, 'Someday');
      await selectMenuItem(user, 'Move up');

      // Between "Work" (10) and "Personal" (20) → their midpoint, renumbering nothing.
      expect(mockUpdateFolder).toHaveBeenCalledWith('f3', { sort_order: 15 });
      expect(renderedFolders()).toStrictEqual(['Work', 'Someday', 'Personal']);
    });

    it('restores the previous order when the reorder fails', async () => {
      mockUpdateFolder.mockRejectedValue(new Error('Server error'));
      const user = userEvent.setup();
      renderWithProviders(<FolderNav />, { folders: FOLDERS });

      await openFolderMenu(user, 'Work');
      await selectMenuItem(user, 'Move down');

      await waitFor(() => {
        expect(renderedFolders()).toStrictEqual(['Work', 'Personal']);
      });
    });

    it('gives each folder a drag handle that is hidden from assistive tech and from touch', () => {
      renderWithProviders(<FolderNav />, { folders: FOLDERS });

      const handles = document.querySelectorAll('[data-folder-drag-handle]');
      expect(handles).toHaveLength(2);
      // The pointer gesture is desktop-only (the menu is the touch/keyboard path), and the grip
      // is not itself focusable — so it must not reach the accessibility tree.
      expect(handles[0]).toHaveClass('hidden', 'md:block');
      expect(handles[0]).toHaveAttribute('aria-hidden', 'true');
      expect(handles[0]).not.toHaveAttribute('tabindex');
    });

    it('keeps the options button visible on touch, where there is no hover to reveal it', () => {
      renderWithProviders(<FolderNav />, { folders: FOLDERS });

      const actions = screen.getByRole('button', { name: /options for work/i }).parentElement;
      expect(actions).toHaveClass('opacity-100', 'md:motion-safe:opacity-0');
    });
  });

  describe('rename form submit via keyboard', () => {
    it('submits rename on Enter key', async () => {
      mockUpdateFolder.mockResolvedValue({
        description: null,
        id: 'f1',
        name: 'Work Renamed',
        created_at: '2025-01-01T00:00:00Z',
        sort_order: 10,
      });

      const user = userEvent.setup();
      renderWithProviders(<FolderNav />, { folders: FOLDERS });

      await openFolderMenu(user, 'Work');
      await selectEdit(user);
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'Work Renamed');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(mockUpdateFolder).toHaveBeenCalledWith('f1', { name: 'Work Renamed' });
      });
    });
  });

  describe('create form submit via keyboard', () => {
    it('submits create on Enter key', async () => {
      mockCreateFolder.mockResolvedValue({
        description: null,
        id: 'f3',
        name: 'Projects',
        created_at: '2025-01-03T00:00:00Z',
        sort_order: 30,
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

  describe('attention (amber) + overdue (red) count badges', () => {
    it('shows an amber attention badge (high-priority or due today) and a red overdue badge', () => {
      renderWithProviders(<FolderNav />, {
        folders: FOLDERS,
        tasks: [
          taskItem({ id: 'a', folder_id: 'f1', due_date: dueYMD(-1) }), // past → overdue
          taskItem({ id: 'b', folder_id: 'f1', due_date: dueYMD(0) }), // today → attention
          taskItem({ id: 'c', folder_id: 'f1', priority: 'high', due_date: null }), // hi-pri → attention
        ],
      });

      const attention = screen.getByLabelText('2 high-priority or due today');
      expect(attention).toHaveTextContent('2');
      expect(attention).toHaveClass('text-accent-amber');
      const overdue = screen.getByLabelText('1 overdue');
      expect(overdue).toHaveTextContent('1');
      expect(overdue).toHaveClass('text-accent-red');
    });

    it('renders neither badge for a folder with nothing to flag (no "0" chip)', () => {
      renderWithProviders(<FolderNav />, {
        folders: FOLDERS,
        tasks: [taskItem({ id: 'a', folder_id: 'f1', due_date: dueYMD(0) })],
      });

      // f1 has its attention badge; f2 (nothing to flag) shows none.
      expect(screen.getByLabelText('1 high-priority or due today')).toBeInTheDocument();
      expect(screen.queryByText('0')).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/overdue/i)).not.toBeInTheDocument();
    });

    it('counts a high-priority overdue task as overdue only, not attention (disjoint)', () => {
      renderWithProviders(<FolderNav />, {
        folders: FOLDERS,
        tasks: [taskItem({ id: 'a', folder_id: 'f1', priority: 'high', due_date: dueYMD(-1) })],
      });

      expect(screen.getByLabelText('1 overdue')).toBeInTheDocument();
      expect(screen.queryByLabelText(/high-priority or due today/i)).not.toBeInTheDocument();
    });

    it('keeps the badge shrink-0 and the name truncating so a long name never clips it', () => {
      renderWithProviders(<FolderNav />, {
        folders: FOLDERS,
        tasks: [taskItem({ id: 'a', folder_id: 'f1', due_date: dueYMD(0) })],
      });

      expect(screen.getByLabelText('1 high-priority or due today')).toHaveClass('shrink-0');
      // The folder name flex-fills and truncates, so it yields room before the badge.
      const link = screen.getByRole('link', { name: /work/i });
      const name = link.querySelector('.truncate');
      expect(name).toHaveClass('truncate', 'min-w-0', 'flex-1');
    });

    it('does not count completed, future-due, or inbox items toward a folder badge', () => {
      renderWithProviders(<FolderNav />, {
        folders: FOLDERS,
        tasks: [
          taskItem({ id: 'done', folder_id: 'f1', due_date: dueYMD(-1), status: 'completed' }),
          taskItem({ id: 'future', folder_id: 'f1', due_date: dueYMD(5) }),
          taskItem({ id: 'inbox', folder_id: null, due_date: dueYMD(-1) }),
        ],
      });

      expect(screen.queryByLabelText(/high-priority or due today/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/overdue/i)).not.toBeInTheDocument();
    });
  });
});
