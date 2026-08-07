import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { useActiveEditorActions } from '@/lib/stores/active-editor-store';
import { renderWithProviders } from '@/lib/test-utils';
import type { Folder } from '@/lib/types';

import { FolderView } from './folder-view';

// Capture the props handed to TaskList so we can assert the wiring — including the empty-state
// passthroughs, whose rendering belongs to TaskList/EmptyState (covered by their own tests).
let lastTaskListScope: unknown;
let lastEmptyMessage: string | undefined;
let lastEmptyDescription: string | undefined;
let lastEmptyAction: React.ReactNode;
let lastSortMode: string | undefined;
jest.mock('./task-list', () => ({
  TaskList: function MockTaskList({
    emptyAction,
    emptyDescription,
    emptyMessage,
    scope,
    sortMode,
  }: {
    emptyAction?: React.ReactNode;
    emptyDescription?: string;
    emptyMessage?: string;
    scope?: unknown;
    sortMode?: string;
  }) {
    lastTaskListScope = scope;
    lastEmptyMessage = emptyMessage;
    lastEmptyDescription = emptyDescription;
    lastEmptyAction = emptyAction;
    lastSortMode = sortMode;
    // Render the action too, so a test can press it exactly as a user would in an empty folder.
    return (
      <div data-testid="task-list">
        {emptyMessage}
        {emptyAction}
      </div>
    );
  },
}));

// The capture box is the shared component — assert the props it is wired with rather than
// re-testing its internals. The stub still exposes the dismiss seam so the close path is real.
let lastCaptureBoxProps: {
  compact?: boolean;
  folderId?: string | null;
  parentId?: string | null;
  parseProjectPrefix?: boolean;
  placeholder?: string;
  onDismiss?: () => void;
};
jest.mock('./capture-box', () => ({
  CaptureBox: function MockCaptureBox(properties: {
    compact?: boolean;
    folderId?: string | null;
    parentId?: string | null;
    parseProjectPrefix?: boolean;
    placeholder?: string;
    onDismiss?: () => void;
  }) {
    lastCaptureBoxProps = properties;
    return (
      <input
        data-testid="capture-box"
        readOnly
        placeholder={properties.placeholder}
        onBlur={properties.onDismiss}
      />
    );
  },
}));

const FOLDERS: Folder[] = [
  { id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z', sort_order: 1 },
  { id: 'f2', name: 'Home', created_at: '2025-01-02T00:00:00Z', sort_order: 2 },
];

/** A sibling of the folder view that can steal the single-open-editor slot, as a task row would. */
function OtherEditorProbe() {
  const { openEditor } = useActiveEditorActions();
  return (
    <button
      type="button"
      onClick={() => {
        openEditor({ itemId: 'some-task', kind: 'title' });
      }}
    >
      open other editor
    </button>
  );
}

/**
 * Force a `prefers-reduced-motion` result for the duration of a test. `restoreMocks`
 * (jest.config) reverts the spy to the jest.setup stub after each test.
 */
function mockReducedMotion(matches: boolean): void {
  const mql = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  } as unknown as MediaQueryList;
  jest.spyOn(globalThis, 'matchMedia').mockReturnValue(mql);
}

const addTaskButton = () => screen.getByRole('button', { name: 'Add task to Work' });

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

    it('passes a folder-specific empty description instead of the Inbox default', () => {
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      // "Capture something above." is true on the Inbox and false here — there is nothing above.
      expect(lastEmptyDescription).toBe('Add your first task to this folder.');
    });
  });

  describe('the header "+" affordance', () => {
    it('is named for the folder and sits before "Collapse all"', () => {
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      const buttons = screen.getAllByRole('button');
      const names = buttons.map((button) => button.getAttribute('aria-label'));
      expect(names).toContain('Add task to Work');
      expect(names.indexOf('Add task to Work')).toBeLessThan(names.indexOf('Collapse all'));
    });

    it('reports the box as collapsed until it is pressed', () => {
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      expect(addTaskButton()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('capture-box')).not.toBeInTheDocument();
    });

    it('reveals a compact capture box wired to this folder', async () => {
      const user = userEvent.setup();
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      await user.click(addTaskButton());

      expect(screen.getByTestId('capture-box')).toBeInTheDocument();
      expect(addTaskButton()).toHaveAttribute('aria-expanded', 'true');
      expect(lastCaptureBoxProps.compact).toBe(true);
      expect(lastCaptureBoxProps.folderId).toBe('f1');
      expect(lastCaptureBoxProps.placeholder).toBe('Add task…');
      // A top-level capture only — a folder box never creates a subtask.
      expect(lastCaptureBoxProps.parentId).toBeUndefined();
    });

    it('leaves project-prefix parsing off (a prefix would pull the capture out of the folder)', async () => {
      const user = userEvent.setup();
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      await user.click(addTaskButton());

      expect(lastCaptureBoxProps.parseProjectPrefix).toBeFalsy();
    });

    it('closes the box when pressed again', async () => {
      mockReducedMotion(true);
      const user = userEvent.setup();
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      await user.click(addTaskButton());
      await user.click(addTaskButton());

      expect(screen.queryByTestId('capture-box')).not.toBeInTheDocument();
      expect(addTaskButton()).toHaveAttribute('aria-expanded', 'false');
    });

    it('suppresses the default mousedown focus shift while open, so the box cannot re-open itself', () => {
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      // Closed: the press must NOT be swallowed (nothing to protect).
      expect(fireEvent.mouseDown(addTaskButton())).toBe(true);

      fireEvent.click(addTaskButton());

      // Open: preventDefault keeps focus in the box, so its blur-dismiss can't fire first and
      // make the click handler see a closed box and re-open what it just closed.
      expect(fireEvent.mouseDown(addTaskButton())).toBe(false);
    });

    it('keeps the box mounted through its exit animation, then drops it', async () => {
      const user = userEvent.setup();
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      await user.click(addTaskButton());
      await user.click(addTaskButton());

      const reveal = screen.getByTestId('animated-height-reveal');
      expect(reveal).toHaveClass('animate-collapse-y');
      expect(screen.getByTestId('capture-box')).toBeInTheDocument();

      act(() => {
        fireEvent.animationEnd(reveal);
      });

      expect(screen.queryByTestId('capture-box')).not.toBeInTheDocument();
    });

    it('drops the box immediately under reduced motion (no animation to wait on)', async () => {
      mockReducedMotion(true);
      const user = userEvent.setup();
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      await user.click(addTaskButton());
      await user.click(addTaskButton());

      // No animationEnd is fired, yet the box is gone — never stranded on screen.
      expect(screen.queryByTestId('capture-box')).not.toBeInTheDocument();
    });

    it('closes the box when the capture box dismisses itself', async () => {
      mockReducedMotion(true);
      const user = userEvent.setup();
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      await user.click(addTaskButton());
      act(() => {
        lastCaptureBoxProps.onDismiss?.();
      });

      expect(screen.queryByTestId('capture-box')).not.toBeInTheDocument();
    });

    it('closes the box when another inline editor takes the single-open slot', async () => {
      mockReducedMotion(true);
      const user = userEvent.setup();
      renderWithProviders(
        <>
          <FolderView folderId="f1" />
          <OtherEditorProbe />
        </>,
        { folders: FOLDERS },
      );

      await user.click(addTaskButton());
      await user.click(screen.getByRole('button', { name: 'open other editor' }));

      expect(screen.queryByTestId('capture-box')).not.toBeInTheDocument();
    });
  });

  describe('the empty-folder action', () => {
    it('offers an "Add task" action while the box is closed', () => {
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      expect(lastEmptyAction).toBeDefined();
      expect(screen.getByRole('button', { name: 'Add task' })).toBeInTheDocument();
    });

    it('opens the same box as the header "+"', async () => {
      const user = userEvent.setup();
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      await user.click(screen.getByRole('button', { name: 'Add task' }));

      expect(screen.getByTestId('capture-box')).toBeInTheDocument();
      expect(addTaskButton()).toHaveAttribute('aria-expanded', 'true');
    });

    it('is withheld while the box is open, so it is never a dead control', async () => {
      const user = userEvent.setup();
      renderWithProviders(<FolderView folderId="f1" />, { folders: FOLDERS });

      await user.click(addTaskButton());

      expect(lastEmptyAction).toBeUndefined();
      expect(screen.queryByRole('button', { name: 'Add task' })).not.toBeInTheDocument();
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

    it('offers no capture affordance', () => {
      renderWithProviders(<FolderView folderId="missing" />, { folders: FOLDERS });

      expect(screen.queryByRole('button', { name: /add task/i })).not.toBeInTheDocument();
    });
  });
});
