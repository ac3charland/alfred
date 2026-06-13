import { screen } from '@testing-library/react';
import * as React from 'react';

import { renderWithProviders } from '@/lib/test-utils';
import type { Folder } from '@/lib/types';

import { FolderView } from './folder-view';

// Capture the scope/emptyMessage handed to TaskList so we can assert the wiring.
let lastTaskListScope: unknown;
let lastEmptyMessage: string | undefined;
jest.mock('./task-list', () => ({
  TaskList: function MockTaskList({
    emptyMessage,
    scope,
  }: {
    emptyMessage?: string;
    scope?: unknown;
  }) {
    lastTaskListScope = scope;
    lastEmptyMessage = emptyMessage;
    return <div data-testid="task-list">{emptyMessage}</div>;
  },
}));

const FOLDERS: Folder[] = [{ id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z' }];

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

  describe('when no folder matches the id', () => {
    it('renders a not-found message instead of a list', () => {
      renderWithProviders(<FolderView folderId="missing" />, { folders: FOLDERS });

      expect(screen.getByText('Folder not found')).toBeInTheDocument();
      expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
    });

    it('does not render a collapse button when the folder is not found', () => {
      renderWithProviders(<FolderView folderId="missing" />, { folders: FOLDERS });

      expect(screen.queryByRole('button', { name: /collapse all tasks/i })).not.toBeInTheDocument();
    });
  });

  describe('collapse all button', () => {
    it('renders a collapse all button in the header when the folder exists', () => {
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      expect(screen.getByRole('button', { name: /collapse all tasks/i })).toBeInTheDocument();
    });
  });
});
