import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { renderWithProviders } from '@/lib/test-utils';
import type { Folder } from '@/lib/types';

import { FolderView } from './folder-view';

// Capture the scope/emptyMessage/sortMode handed to TaskList so we can assert the wiring.
let lastTaskListScope: unknown;
let lastEmptyMessage: string | undefined;
let lastSortMode: string | undefined;
jest.mock('./task-list', () => ({
  TaskList: function MockTaskList({
    emptyMessage,
    scope,
    sortMode,
  }: {
    emptyMessage?: string;
    scope?: unknown;
    sortMode?: string;
  }) {
    lastTaskListScope = scope;
    lastEmptyMessage = emptyMessage;
    lastSortMode = sortMode;
    return <div data-testid="task-list">{emptyMessage}</div>;
  },
}));

const FOLDERS: Folder[] = [
  { id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z', sort_order: 1 },
  { id: 'f2', name: 'Home', created_at: '2025-01-02T00:00:00Z', sort_order: 2 },
];

describe('FolderView', () => {
  describe('when the folder exists in the store', () => {
    it('renders the folder name as the eyebrow label', () => {
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      expect(screen.getByText('Work')).toBeInTheDocument();
    });

    it('renders a TaskList scoped to that folder', () => {
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      expect(screen.getByTestId('task-list')).toBeInTheDocument();
      expect(lastTaskListScope).toEqual({ type: 'folder', folderId: 'f1' });
    });

    it('passes a folder-specific empty message', () => {
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      expect(lastEmptyMessage).toBe('No tasks in Work');
    });
  });

  describe('the sort control', () => {
    it('opens on the folder ranking by priority', () => {
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      expect(screen.getByRole('button', { name: 'Sort by: Priority' })).toBeInTheDocument();
      expect(lastSortMode).toBe('priority');
    });

    it('re-ranks the list by due date once that is picked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      await user.click(screen.getByRole('button', { name: 'Sort by: Priority' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Due date' }));

      expect(lastSortMode).toBe('due');
      expect(screen.getByRole('button', { name: 'Sort by: Due date' })).toBeInTheDocument();
    });

    it('keeps each folder on its own ordering', async () => {
      const user = userEvent.setup();
      const { rerender } = renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      await user.click(screen.getByRole('button', { name: 'Sort by: Priority' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Due date' }));

      // A second folder is untouched by the first folder's choice…
      rerender(<FolderView folderId="f2" />);
      expect(lastSortMode).toBe('priority');

      // …and the first folder still remembers its own when you come back.
      rerender(<FolderView folderId="f1" />);
      expect(lastSortMode).toBe('due');
    });
  });

  describe('when no folder matches the id', () => {
    it('renders a not-found message instead of a list', () => {
      renderWithProviders(<FolderView folderId="missing" />, { folders: FOLDERS });

      expect(screen.getByText('Folder not found')).toBeInTheDocument();
      expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
    });
  });
});
