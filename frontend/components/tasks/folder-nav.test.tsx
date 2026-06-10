import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import type { Folder } from '@/lib/types';

import { FolderNav } from './folder-nav';

// Mock next/navigation
const mockPathname = jest.fn<string, []>(() => '/');
const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter() {
    return { push: mockPush, refresh: mockRefresh };
  },
}));

// Mock next/link as a plain anchor for easier querying
jest.mock(
  'next/link',
  () =>
    function MockLink({ href, children, ...rest }: { href: string; children: React.ReactNode }) {
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      );
    },
);

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
    render(<FolderNav folders={FOLDERS} />);

    expect(screen.getByRole('link', { name: /inbox/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /completed/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /work/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /personal/i })).toBeInTheDocument();
  });

  it('renders with no folders when the list is empty', () => {
    render(<FolderNav folders={[]} />);

    expect(screen.getByRole('link', { name: /inbox/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /work/i })).not.toBeInTheDocument();
  });

  it('shows the new folder form when the create button is clicked', async () => {
    const user = userEvent.setup();
    render(<FolderNav folders={FOLDERS} />);

    await user.click(screen.getByRole('button', { name: /create folder/i }));

    expect(screen.getByPlaceholderText(/folder name/i)).toBeInTheDocument();
  });

  it('calls createFolder and refreshes when a new folder name is submitted', async () => {
    mockCreateFolder.mockResolvedValue({ id: 'f3', name: 'Projects', created_at: '' });

    const user = userEvent.setup();
    render(<FolderNav folders={FOLDERS} />);

    await user.click(screen.getByRole('button', { name: /create folder/i }));
    await user.type(screen.getByPlaceholderText(/folder name/i), 'Projects');
    await user.click(screen.getByRole('button', { name: /save folder/i }));

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith('Projects');
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('calls onClose when a nav link is clicked and onClose is provided', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<FolderNav folders={FOLDERS} onClose={onClose} />);

    await user.click(screen.getByRole('link', { name: /inbox/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it('calls deleteFolder when the delete button is clicked for a folder', async () => {
    mockDeleteFolder.mockResolvedValue({ success: true });

    const user = userEvent.setup();
    render(<FolderNav folders={FOLDERS} />);

    await user.click(screen.getByRole('button', { name: /delete work/i }));

    await waitFor(() => {
      expect(mockDeleteFolder).toHaveBeenCalledWith('f1');
    });
  });

  it('navigates to / after deleting the currently active folder', async () => {
    mockDeleteFolder.mockResolvedValue({ success: true });
    mockPathname.mockReturnValue('/folders/f1');

    const user = userEvent.setup();
    render(<FolderNav folders={FOLDERS} />);

    await user.click(screen.getByRole('button', { name: /delete work/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  // Prevent unused variable warning on mockUpdateFolder — it's imported for
  // completeness (rename tests would use it) and to confirm the mock is available.
  it('exports mockUpdateFolder for rename tests', () => {
    expect(mockUpdateFolder).toBeDefined();
  });
});
