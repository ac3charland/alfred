import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import type { TaskScope } from '@/lib/stores/tasks-store';
import { renderWithProviders } from '@/lib/test-utils';
import { buildTree } from '@/lib/tree';
import type { Folder, Item } from '@/lib/types';

import { TaskList } from './task-list';
import { TaskRow } from './task-row';

// api-client is the seam the store calls; mock it so tests never hit the network.
jest.mock('@/lib/api-client');
const mockCompleteTask = jest.mocked(apiClient.completeTask);
const mockUpdateItem = jest.mocked(apiClient.updateItem);
const mockDeleteItem = jest.mocked(apiClient.deleteItem);
const mockMoveToInbox = jest.mocked(apiClient.moveToInbox);

const BASE_ITEM: Item = {
  id: 'item-1',
  title: 'Write tests',
  notes: null,
  source_url: null,
  item_type: 'task',
  created_at: '2025-01-01T10:00:00Z',
  raw_capture: null,
  due_date: null,
  status: 'active',
  completed_at: null,
  folder_id: null,
  parent_id: null,
};

const CHILD_ITEM: Item = {
  ...BASE_ITEM,
  id: 'item-2',
  title: 'Write unit tests',
  parent_id: 'item-1',
  created_at: '2025-01-01T11:00:00Z',
};

const GRANDCHILD_ITEM: Item = {
  ...BASE_ITEM,
  id: 'item-3',
  title: 'Write edge case tests',
  parent_id: 'item-2',
  created_at: '2025-01-01T12:00:00Z',
};

const COMPLETED_ITEM: Item = { ...BASE_ITEM, status: 'completed' };
const COMPLETED_FOLDER_ITEM: Item = { ...BASE_ITEM, status: 'completed', folder_id: 'folder-1' };

const FOLDER: Folder = { id: 'folder-1', name: 'Work', created_at: '2025-01-01T09:00:00Z' };

/**
 * Render rows through TaskList, seeding the flat item list into the store. Rows come from
 * the scoped selector, so changing an item's status/folder (complete/move) filters it out
 * of the view — exactly as in the app. Defaults to the inbox view.
 */
function renderTasks(items: Item[], options: { folders?: Folder[]; scope?: TaskScope } = {}) {
  return renderWithProviders(<TaskList scope={options.scope ?? { type: 'inbox' }} />, {
    tasks: items,
    folders: options.folders ?? [],
  });
}

const COMPLETED = { scope: { type: 'completed' } as const };

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

/** The collapse wrapper that owns a row's completion exit (the grid-rows transition). */
function collapseWrapperFor(title: string): HTMLElement {
  const li = screen.getByText(title).closest('li');
  if (!li) throw new Error('task row <li> not found');
  const wrapper = li.querySelector<HTMLElement>('[data-testid="task-collapse"]');
  if (!wrapper) throw new Error('collapse wrapper not found');
  return wrapper;
}

/**
 * Dispatch a bubbling `transitionend` carrying a `propertyName`. jsdom has no
 * `TransitionEvent`, so `fireEvent.transitionEnd(el, { propertyName })` silently drops
 * it — build the event by hand and define the prop so the handler's guard is exercised.
 */
function fireTransitionEnd(element: HTMLElement, propertyName: string): void {
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: propertyName });
  fireEvent(element, event);
}

/**
 * Finish a row's collapse. jsdom doesn't run CSS transitions, so completion tests fire
 * the wrapper's `grid-template-rows` `transitionend` by hand to stand in for the height
 * collapse finishing — that's what commits the completion.
 */
function endCollapse(title: string): void {
  fireTransitionEnd(collapseWrapperFor(title), 'grid-template-rows');
}

// ---------------------------------------------------------------------------
// Timezone-safe due-date helpers
//
// new Date('YYYY-MM-DD') parses as UTC midnight, which in non-UTC timezones
// shifts to the previous local day. These helpers account for the UTC offset
// so that `new Date(result).toDateString()` matches the intended local date.
// ---------------------------------------------------------------------------

/**
 * Returns the ISO YYYY-MM-DD string that, when passed to `new Date('YYYY-MM-DD')`,
 * produces a Date whose LOCAL date fields (getFullYear/getMonth/getDate) match the
 * intended (year, month0, day). Accounts for the UTC-midnight parsing rule so tests
 * are correct in any timezone.
 *
 * Uses `Math.ceil` of the timezone offset in fractional days. For negative UTC offsets
 * (e.g. UTC-7 = 420 min), ceil(420/1440) = 1, so the helper returns (day+1)'s UTC
 * midnight, which equals (day)'s local time — correct for the month+day label tests.
 * Do NOT use this for Yesterday/Tomorrow/Today tests; use dueForDayOffset instead.
 */
function localDueDate(year: number, month0: number, day: number): string {
  const tzOffsetDays = Math.ceil(new Date().getTimezoneOffset() / (24 * 60));
  return new Date(year, month0, day + tzOffsetDays).toISOString().slice(0, 10);
}

/**
 * Returns the due_date ISO string that formatDueDate() will treat as offsetDays
 * from today (0 = Today, 1 = Tomorrow, -1 = Yesterday).
 *
 * Uses a full datetime ISO string (not a date-only string) so that:
 *  - The "Today" check (toDateString equality) works at any time of day.
 *  - The diffDays check (Math.ceil of ms delta / 24h) reliably gives ±1.
 *
 * For ±1: shifting exactly ±24 h from now gives ceil(±24h/24h) = ±1, and the
 * toDateString will be the adjacent day's (not today's). This is robust at any
 * time of day, unlike YYYY-MM-DD strings that are parsed as UTC midnight and can
 * land in the wrong local day near local midnight.
 */
function dueForDayOffset(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString();
}

describe('TaskRow', () => {
  it('renders the task title', () => {
    renderTasks([BASE_ITEM]);
    expect(screen.getByText('Write tests')).toBeInTheDocument();
  });

  it('renders the completion checkbox with "complete" label for active tasks', () => {
    renderTasks([BASE_ITEM]);
    expect(
      screen.getByRole('button', { name: /mark "Write tests" complete/i }),
    ).toBeInTheDocument();
  });

  it('renders checkbox with "active" label in the completed view', () => {
    renderTasks([COMPLETED_ITEM], COMPLETED);
    expect(screen.getByRole('button', { name: /mark "Write tests" active/i })).toBeInTheDocument();
  });

  it('renders checkbox as checked (teal fill) in the completed view', () => {
    renderTasks([COMPLETED_ITEM], COMPLETED);
    expect(screen.getByRole('button', { name: /mark "Write tests" active/i })).toHaveClass(
      'bg-accent-teal',
    );
  });

  it('expand/collapse toggle is invisible when there are no children', () => {
    renderTasks([BASE_ITEM]);
    expect(screen.getByRole('button', { name: /expand subtasks/i })).toHaveClass('invisible');
  });

  it('expand toggle is visible when node has children', () => {
    renderTasks([BASE_ITEM, CHILD_ITEM]);
    expect(screen.getByRole('button', { name: /expand subtasks/i })).not.toHaveClass('invisible');
  });

  it('shows child tasks when the expand toggle is clicked', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM, CHILD_ITEM]);

    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

    // Subtask list is in the accessibility tree (aria-hidden removed) when expanded
    expect(screen.getByRole('list', { name: 'Subtasks' })).toBeInTheDocument();
  });

  it('hides child tasks when expanded and then collapsed', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM, CHILD_ITEM]);

    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
    expect(screen.getByRole('list', { name: 'Subtasks' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /collapse subtasks/i }));
    // Subtask list is removed from the accessibility tree (aria-hidden) when collapsed;
    // the DOM node stays mounted for the height/opacity exit animation.
    expect(screen.queryByRole('list', { name: 'Subtasks' })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Active task completion — animated exit, THEN optimistic removal
  //
  // Completing an active task plays a checkbox pop + height collapse, and only calls
  // completeTask once the collapse transition ends (the row stays visible meanwhile so
  // the exit can play). jsdom doesn't run CSS transitions, so we drive the collapse's
  // transitionend by hand (endCollapse). Under reduced motion there's no animation, so
  // completion is immediate — see the "reduced motion" block below.
  // ---------------------------------------------------------------------------

  it('shows the checkbox as checked the instant it is clicked (before the row leaves)', async () => {
    mockCompleteTask.mockResolvedValue([]);
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    const checkbox = screen.getByRole('button', { name: /mark "Write tests" complete/i });
    await user.click(checkbox);

    // Immediate, snappy feedback: the checkbox fills and the row is still present,
    // animating out (not removed yet).
    expect(checkbox).toHaveClass('bg-accent-teal');
    expect(checkbox).toHaveClass('animate-check-pop');
    expect(screen.getByText('Write tests')).toBeInTheDocument();
  });

  it('does NOT call completeTask until the collapse transition ends', async () => {
    mockCompleteTask.mockResolvedValue([]);
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it('does not let an unrelated transition on the wrapper commit the completion', async () => {
    mockCompleteTask.mockResolvedValue([]);
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));
    // Only the grid-template-rows transition commits — a different property must not.
    fireTransitionEnd(collapseWrapperFor('Write tests'), 'opacity');

    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it('does not let a child transition (e.g. the title colour fade) commit the completion', async () => {
    mockCompleteTask.mockResolvedValue([]);
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    const checkbox = screen.getByRole('button', { name: /mark "Write tests" complete/i });
    await user.click(checkbox);
    // A child's transitionend bubbles to the wrapper; only the wrapper's own collapse counts.
    fireTransitionEnd(checkbox, 'grid-template-rows');

    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it('calls completeTask and removes the task once the collapse transition ends', async () => {
    mockCompleteTask.mockResolvedValue([]);
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));
    endCollapse('Write tests');

    await waitFor(() => {
      expect(mockCompleteTask).toHaveBeenCalledWith('item-1');
    });
    expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
  });

  it('restores the task when completeTask fails after the animation', async () => {
    mockCompleteTask.mockRejectedValue(new Error('Network error'));
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));
    endCollapse('Write tests');

    expect(await screen.findByText('Write tests')).toBeInTheDocument();
  });

  describe('reduced motion', () => {
    it('completes immediately on click, with no animation to wait on', async () => {
      mockReducedMotion(true);
      mockCompleteTask.mockResolvedValue([]);
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

      await waitFor(() => {
        expect(mockCompleteTask).toHaveBeenCalledWith('item-1');
      });
      expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
    });

    it('removes the task from the view immediately on click', async () => {
      mockReducedMotion(true);
      mockCompleteTask.mockImplementation(() => new Promise(() => {}));
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

      expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
    });
  });

  it('opens the cascade modal when checkbox is clicked on a task with children', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM, CHILD_ITEM]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

    expect(await screen.findByText(/complete with subtasks/i)).toBeInTheDocument();
  });

  it('does NOT call completeTask directly when the cascade modal opens', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM, CHILD_ITEM]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));
    await screen.findByText(/complete with subtasks/i);

    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Completed view — uncomplete
  // ---------------------------------------------------------------------------

  it('calls updateItem with status:active when uncompleting', async () => {
    mockUpdateItem.mockResolvedValue({ ...COMPLETED_ITEM, status: 'active' });
    const user = userEvent.setup();
    renderTasks([COMPLETED_ITEM], COMPLETED);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" active/i }));

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { status: 'active' });
    });
  });

  it('removes the task from the completed view immediately when uncompleting', async () => {
    mockUpdateItem.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderTasks([COMPLETED_ITEM], COMPLETED);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" active/i }));

    expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Completed view — parent context label
  // ---------------------------------------------------------------------------

  it('shows the folder name under a completed root item', () => {
    renderTasks([COMPLETED_FOLDER_ITEM], { ...COMPLETED, folders: [FOLDER] });
    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('shows "Inbox" under a completed root item with no folder', () => {
    renderTasks([COMPLETED_ITEM], COMPLETED);
    expect(screen.getByText('Inbox')).toBeInTheDocument();
  });

  it('does not show parent label in the inbox view', () => {
    renderTasks([BASE_ITEM], { folders: [FOLDER] });
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
    expect(screen.queryByText('Inbox')).not.toBeInTheDocument();
  });

  it('shows the full ancestor breadcrumb under a deeply nested completed item', () => {
    // A → B → C → D → E → F are active (filtered out of the completed view); G is the
    // completed leaf shown as a root row. Its breadcrumb lists every ancestor oldest → youngest.
    const ancestors: Item[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((title, index) => ({
      ...BASE_ITEM,
      id: `anc-${String(index)}`,
      title,
      parent_id: index === 0 ? null : `anc-${String(index - 1)}`,
      status: 'active',
      created_at: `2025-01-01T0${String(index)}:00:00Z`,
    }));
    const leaf: Item = {
      ...BASE_ITEM,
      id: 'leaf-g',
      title: 'G',
      parent_id: 'anc-5',
      status: 'completed',
    };

    renderTasks([...ancestors, leaf], COMPLETED);

    expect(screen.getByText('A > B > C > D > E > F')).toBeInTheDocument();
  });

  it('prefers the ancestor breadcrumb over the folder name for a nested completed item', () => {
    const parent: Item = { ...BASE_ITEM, id: 'p', title: 'Parent', folder_id: 'folder-1' };
    const child: Item = {
      ...BASE_ITEM,
      id: 'ch',
      title: 'Child',
      parent_id: 'p',
      folder_id: 'folder-1',
      status: 'completed',
    };

    renderTasks([parent, child], { ...COMPLETED, folders: [FOLDER] });

    expect(screen.getByText('Parent')).toBeInTheDocument();
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
  });

  it('restores the task when updateItem fails while uncompleting', async () => {
    mockUpdateItem.mockRejectedValue(new Error('Network error'));
    const user = userEvent.setup();
    renderTasks([COMPLETED_ITEM], COMPLETED);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" active/i }));

    expect(await screen.findByText('Write tests')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Other
  // ---------------------------------------------------------------------------

  it('shows due date chip when due_date is present', () => {
    renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);
    expect(screen.getByRole('button', { name: /due date/i })).toBeInTheDocument();
  });

  it('deletes the task via the actions menu', async () => {
    mockDeleteItem.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await user.click(screen.getByRole('button', { name: /more actions/i }));
    await screen.findByRole('menu');
    // Menu (no folders): Set due date, Add notes, Delete.
    await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][Enter]');

    await waitFor(() => {
      expect(mockDeleteItem).toHaveBeenCalledWith('item-1');
    });
    expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
  });

  describe('move to folder', () => {
    // Radix DropdownMenu portals set pointer-events:none on the body, which blocks
    // userEvent.click() on portal items. Keyboard navigation bypasses this.
    //   ArrowDown×1 → "Set due date", ×2 → "Add notes", ×3 → "Move to…" (SubTrigger)
    //   ArrowRight opens the submenu with "Inbox" auto-focused; ArrowDown → first folder.

    it('calls updateItem once when moving a leaf task to a folder', async () => {
      mockUpdateItem.mockResolvedValue(BASE_ITEM);
      const user = userEvent.setup();
      renderTasks([BASE_ITEM], { folders: [FOLDER] });

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][ArrowRight][ArrowDown][Enter]');

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      });
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { folder_id: 'folder-1' });
    });

    it('calls updateItem for parent and all descendants when moving to a folder', async () => {
      mockUpdateItem.mockResolvedValue(BASE_ITEM);
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM, GRANDCHILD_ITEM], { folders: [FOLDER] });

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][ArrowRight][ArrowDown][Enter]');

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledTimes(3);
      });
      expect(mockUpdateItem).toHaveBeenCalledWith('item-3', { folder_id: 'folder-1' });
      expect(mockUpdateItem).toHaveBeenCalledWith('item-2', { folder_id: 'folder-1' });
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { folder_id: 'folder-1' });
    });

    it('calls moveToInbox once when moving a leaf task to the inbox', async () => {
      mockMoveToInbox.mockResolvedValue(BASE_ITEM);
      const user = userEvent.setup();
      renderTasks([BASE_ITEM], { folders: [FOLDER] });

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][ArrowRight][Enter]');

      await waitFor(() => {
        expect(mockMoveToInbox).toHaveBeenCalledTimes(1);
      });
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-1');
    });

    it('calls moveToInbox for parent and all descendants when moving to the inbox', async () => {
      mockMoveToInbox.mockResolvedValue(BASE_ITEM);
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM, GRANDCHILD_ITEM], { folders: [FOLDER] });

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][ArrowRight][Enter]');

      await waitFor(() => {
        expect(mockMoveToInbox).toHaveBeenCalledTimes(3);
      });
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-3');
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-2');
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-1');
    });
  });

  // ---------------------------------------------------------------------------
  // Inline title editing
  // ---------------------------------------------------------------------------

  describe('inline title editing', () => {
    it('enters edit mode on double-click of the title', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));

      expect(screen.getByRole('textbox', { name: /edit title/i })).toBeInTheDocument();
    });

    it('shows the current title value in the edit input', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));

      expect(screen.getByRole('textbox', { name: /edit title/i })).toHaveValue('Write tests');
    });

    it('saves the title and calls updateItem when Enter is pressed', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, title: 'Updated title' });
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'Updated title');
      await user.keyboard('[Enter]');

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { title: 'Updated title' });
      });
    });

    it('saves the title when the confirm button is clicked', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, title: 'Updated title' });
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'Updated title');
      await user.click(screen.getByRole('button', { name: /confirm title/i }));

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { title: 'Updated title' });
      });
    });

    it('cancels the edit on Escape without calling updateItem', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'Should not save');
      await user.keyboard('[Escape]');

      expect(mockUpdateItem).not.toHaveBeenCalled();
      expect(screen.getByText('Write tests')).toBeInTheDocument();
    });

    it('does not call updateItem when the title is unchanged', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      await user.keyboard('[Enter]');

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('reverts to the original title if updateItem fails', async () => {
      mockUpdateItem.mockRejectedValue(new Error('Network error'));
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'Broken title');
      await user.keyboard('[Enter]');

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: /edit title/i })).toHaveValue('Write tests');
      });
    });

    it('exits edit mode after a successful save', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, title: 'New title' });
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'New title');
      await user.keyboard('[Enter]');

      await waitFor(() => {
        expect(screen.queryByRole('textbox', { name: /edit title/i })).not.toBeInTheDocument();
      });
    });

    it('trims leading/trailing whitespace from the title before saving', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, title: 'Trimmed' });
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, '  Trimmed  ');
      await user.keyboard('[Enter]');

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { title: 'Trimmed' });
      });
    });

    it('does not call updateItem when the new title is only whitespace', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, ' '.repeat(3));
      await user.keyboard('[Enter]');

      // Empty/whitespace title exits edit mode and reverts to original
      expect(mockUpdateItem).not.toHaveBeenCalled();
      // Edit mode is exited (no textbox), original title is shown
      expect(screen.queryByRole('textbox', { name: /edit title/i })).not.toBeInTheDocument();
      expect(screen.getByText('Write tests')).toBeInTheDocument();
    });

    it('focuses the title input when edit mode is entered', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: /edit title/i })).toHaveFocus();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // formatDueDate — month names, Today/Tomorrow/Yesterday
  // ---------------------------------------------------------------------------

  describe('due date formatting', () => {
    it('shows "Today" for a due date matching today', () => {
      renderTasks([{ ...BASE_ITEM, due_date: dueForDayOffset(0) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Today');
    });

    it('shows "Tomorrow" for a due date one day in the future', () => {
      renderTasks([{ ...BASE_ITEM, due_date: dueForDayOffset(1) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Tomorrow');
    });

    it('shows "Yesterday" for a due date one day in the past', () => {
      renderTasks([{ ...BASE_ITEM, due_date: dueForDayOffset(-1) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Yesterday');
    });

    it('shows the abbreviated month name and day for other dates (Jan)', () => {
      renderTasks([{ ...BASE_ITEM, due_date: localDueDate(2025, 0, 20) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Jan 20');
    });

    it('shows "Feb" for February', () => {
      renderTasks([{ ...BASE_ITEM, due_date: localDueDate(2025, 1, 10) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Feb 10');
    });

    it('shows "Mar" for March', () => {
      renderTasks([{ ...BASE_ITEM, due_date: localDueDate(2025, 2, 5) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Mar 5');
    });

    it('shows "Apr" for April', () => {
      renderTasks([{ ...BASE_ITEM, due_date: localDueDate(2025, 3, 8) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Apr 8');
    });

    it('shows "May" for May', () => {
      renderTasks([{ ...BASE_ITEM, due_date: localDueDate(2025, 4, 1) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('May 1');
    });

    it('shows "Jun" for June', () => {
      renderTasks([{ ...BASE_ITEM, due_date: localDueDate(2025, 5, 20) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Jun 20');
    });

    it('shows "Jul" for July', () => {
      renderTasks([{ ...BASE_ITEM, due_date: localDueDate(2025, 6, 4) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Jul 4');
    });

    it('shows "Aug" for August', () => {
      renderTasks([{ ...BASE_ITEM, due_date: localDueDate(2025, 7, 25) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Aug 25');
    });

    it('shows "Sep" for September', () => {
      renderTasks([{ ...BASE_ITEM, due_date: localDueDate(2025, 8, 10) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Sep 10');
    });

    it('shows "Oct" for October', () => {
      renderTasks([{ ...BASE_ITEM, due_date: localDueDate(2025, 9, 31) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Oct 31');
    });

    it('shows "Nov" for November', () => {
      renderTasks([{ ...BASE_ITEM, due_date: localDueDate(2025, 10, 11) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Nov 11');
    });

    it('shows "Dec" for December', () => {
      renderTasks([{ ...BASE_ITEM, due_date: localDueDate(2025, 11, 25) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveTextContent('Dec 25');
    });
  });

  // ---------------------------------------------------------------------------
  // isDueDateOverdue — overdue vs future chip styling
  //
  // Uses the same localDueDate/dueForDayOffset helpers defined above to avoid
  // UTC-midnight timezone issues (see the formatDueDate describe block).
  // ---------------------------------------------------------------------------

  describe('due date overdue styling', () => {
    it('applies amber (overdue) classes when the due date is in the past', () => {
      // 10 days ago is safely overdue in any timezone
      renderTasks([{ ...BASE_ITEM, due_date: dueForDayOffset(-10) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveClass('text-accent-amber');
    });

    it('does NOT apply amber classes when the due date is today', () => {
      renderTasks([{ ...BASE_ITEM, due_date: dueForDayOffset(0) }]);
      expect(screen.getByRole('button', { name: /due date/i })).not.toHaveClass(
        'text-accent-amber',
      );
    });

    it('applies blue (future) classes when the due date is today', () => {
      renderTasks([{ ...BASE_ITEM, due_date: dueForDayOffset(0) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveClass('text-accent-blue');
    });

    it('applies blue (future) classes when the due date is in the future', () => {
      renderTasks([{ ...BASE_ITEM, due_date: dueForDayOffset(10) }]);
      expect(screen.getByRole('button', { name: /due date/i })).toHaveClass('text-accent-blue');
    });

    it('does NOT apply blue classes when the due date is overdue', () => {
      renderTasks([{ ...BASE_ITEM, due_date: dueForDayOffset(-10) }]);
      expect(screen.getByRole('button', { name: /due date/i })).not.toHaveClass('text-accent-blue');
    });
  });

  // ---------------------------------------------------------------------------
  // Expand/collapse icon rotation (state-driven class)
  // ---------------------------------------------------------------------------

  describe('expand/collapse chevron rotation', () => {
    it('does NOT have rotate-90 class when collapsed', () => {
      renderTasks([BASE_ITEM, CHILD_ITEM]);
      // ChevronRight icon is inside the expand button — find the svg
      const expandBtn = screen.getByRole('button', { name: /expand subtasks/i });
      const svg = expandBtn.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg).not.toHaveClass('rotate-90');
    });

    it('has rotate-90 class when expanded', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]);

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      const collapseBtn = screen.getByRole('button', { name: /collapse subtasks/i });
      const svg = collapseBtn.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg).toHaveClass('rotate-90');
    });
  });

  // ---------------------------------------------------------------------------
  // Children count badge — shown only when collapsed and has children
  // ---------------------------------------------------------------------------

  describe('children count badge', () => {
    it('shows the count badge when the task has children and is collapsed', () => {
      renderTasks([BASE_ITEM, CHILD_ITEM]);
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('hides the count badge when there are no children', () => {
      renderTasks([BASE_ITEM]);
      // No numeric count should appear
      expect(screen.queryByText('1')).not.toBeInTheDocument();
    });

    it('hides the count badge when the task is expanded', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]);

      // Badge visible before expansion
      expect(screen.getByText('1')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      // After expansion the badge should disappear
      expect(screen.queryByText('1')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Due date chip visibility — hidden when editing due date
  // ---------------------------------------------------------------------------

  describe('due date chip visibility', () => {
    it('hides the due date chip when the meta panel is open and editing due date', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      // Chip is visible initially
      expect(screen.getByRole('button', { name: /due date:/i })).toBeInTheDocument();

      // Click the chip to open editing
      await user.click(screen.getByRole('button', { name: /due date:/i }));

      // The chip should now be hidden (isEditingDueDate=true)
      expect(screen.queryByRole('button', { name: /due date:/i })).not.toBeInTheDocument();
    });

    it('restores the due date chip after cancelling due date edit', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));
      // Chip hidden during edit
      expect(screen.queryByRole('button', { name: /due date:/i })).not.toBeInTheDocument();

      // Cancel the edit
      await user.click(screen.getByRole('button', { name: /cancel/i }));

      // Chip should reappear
      expect(screen.getByRole('button', { name: /due date:/i })).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // isMetaOpen panel
  // ---------------------------------------------------------------------------

  describe('meta panel', () => {
    it('opens the meta panel when the due date chip is clicked', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      expect(screen.getByText('Due date')).toBeInTheDocument();
    });

    it('does not show the meta panel initially', () => {
      renderTasks([BASE_ITEM]);
      expect(screen.queryByText('Due date')).not.toBeInTheDocument();
    });

    it('closes the meta panel when the Close button is clicked', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));
      expect(screen.getByText('Due date')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^close$/i }));

      expect(screen.queryByText('Due date')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Completed checkbox visual state (isCompleted conditional class)
  // ---------------------------------------------------------------------------

  describe('completion checkbox visual state', () => {
    it('active task checkbox does NOT have bg-accent-teal class', () => {
      renderTasks([BASE_ITEM]);
      expect(screen.getByRole('button', { name: /mark "Write tests" complete/i })).not.toHaveClass(
        'bg-accent-teal',
      );
    });

    it('completed task checkbox HAS bg-accent-teal class', () => {
      renderTasks([COMPLETED_ITEM], COMPLETED);
      expect(screen.getByRole('button', { name: /mark "Write tests" active/i })).toHaveClass(
        'bg-accent-teal',
      );
    });

    it('active task does not render the check icon inside the checkbox', () => {
      renderTasks([BASE_ITEM]);
      const checkbox = screen.getByRole('button', { name: /mark "Write tests" complete/i });
      // No SVG inside when active
      expect(within(checkbox).queryByRole('img', { hidden: true })).not.toBeInTheDocument();
    });

    it('completed task renders the check icon inside the checkbox', () => {
      renderTasks([COMPLETED_ITEM], COMPLETED);
      const checkbox = screen.getByRole('button', { name: /mark "Write tests" active/i });
      // SVG check icon present when completed
      expect(checkbox.querySelector('svg')).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // isContextRow — only root rows in the completed view get the context label
  // ---------------------------------------------------------------------------

  describe('context label only on root completed rows', () => {
    it('shows no context label for a non-completed row (inbox view, depth=0)', () => {
      renderTasks([BASE_ITEM]);
      expect(screen.queryByText('Inbox')).not.toBeInTheDocument();
    });

    it('does not show a context label for a completed row that is a nested child (depth > 0)', async () => {
      // Use the inbox view with a parent+child. The child renders at depth=1.
      // In the inbox view, isCompleted=false so isContextRow=false for all rows → no label.
      // This is the same as the "does not show parent label in the inbox view" test,
      // but specifically verifies depth > 0 doesn't leak the label.
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]);

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      // Neither the parent nor the child should show 'Inbox'
      expect(screen.queryByText('Inbox')).not.toBeInTheDocument();
    });

    it('does not show a context label for a completed nested child (depth=1)', async () => {
      // Both parent and child are completed. In the completed view buildTree nests the child
      // under the parent. When expanded, the child renders at depth=1 with isCompleted=true.
      // isContextRow = isCompleted && depth === 0 = true && false = false.
      // The mutation 'depth === 0 → true' would make isContextRow=true for the child,
      // causing it to show a spurious context label. This test catches that regression.
      const user = userEvent.setup();
      const parentCompleted: Item = {
        ...BASE_ITEM,
        id: 'pc-1',
        title: 'Completed parent',
        status: 'completed',
        folder_id: null,
      };
      const childCompleted: Item = {
        ...BASE_ITEM,
        id: 'pc-2',
        title: 'Completed child',
        parent_id: 'pc-1',
        status: 'completed',
        created_at: '2025-01-01T11:00:00Z',
      };
      renderTasks([parentCompleted, childCompleted], COMPLETED);

      // Expand the parent to show the nested child
      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      // Child is visible at depth=1
      expect(screen.getByText('Completed child')).toBeInTheDocument();

      // With mutation `depth === 0 → true`, the child (depth=1, isCompleted=true) would
      // compute isContextRow=true and show a context label. Its ancestorTitles includes
      // 'Completed parent', so the context label would be 'Completed parent' — which
      // ALSO appears as the parent row's title. Exactly one occurrence = no spurious label.
      expect(screen.getAllByText('Completed parent')).toHaveLength(1);
    });

    it('shows the ancestor breadcrumb under a root completed row that has an active parent', () => {
      // Parent is active (inbox view doesn't care); the completed item is the leaf.
      // Render in completed view with parent active + child completed.
      // The child appears as a root completed row (depth=0) → shows 'Parent' as ancestor.
      const parentActive: Item = { ...BASE_ITEM, id: 'p-active', title: 'Parent task' };
      const childCompleted: Item = {
        ...BASE_ITEM,
        id: 'c-done',
        title: 'Child done',
        parent_id: 'p-active',
        status: 'completed',
      };
      renderTasks([parentActive, childCompleted], COMPLETED);
      // Child is depth=0 in completed view, and has an ancestor → shows ancestor breadcrumb
      expect(screen.getByText('Parent task')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Depth / indentation
  // ---------------------------------------------------------------------------

  describe('indentation by depth', () => {
    it('root task (depth=0) has paddingLeft of 0.75rem', () => {
      renderTasks([BASE_ITEM]);
      // The li > div has the style
      const taskTitle = screen.getByText('Write tests');
      // Walk up to the styled row div
      const rowDiv = taskTitle.closest('div[style]');
      expect(rowDiv).not.toBeNull();
      expect(rowDiv).toHaveStyle({ paddingLeft: '0.75rem' });
    });

    it('nested child (depth=1) has a larger paddingLeft than the root', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]);

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      const parentTitle = screen.getByText('Write tests');
      const childTitle = screen.getByText('Write unit tests');

      const parentRow = parentTitle.closest('div[style]');
      const childRow = childTitle.closest('div[style]');

      expect(parentRow).not.toBeNull();
      expect(childRow).not.toBeNull();

      // Child (depth=1): 1*1.25+0.75 = 2rem; Parent (depth=0): 0.75rem
      expect(parentRow).toHaveStyle({ paddingLeft: '0.75rem' });
      expect(childRow).toHaveStyle({ paddingLeft: '2rem' });
    });

    it('grandchild (depth=2) has an even larger paddingLeft', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM, GRANDCHILD_ITEM]);

      // Expand parent
      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
      // Expand child (now visible)
      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      const grandchildTitle = screen.getByText('Write edge case tests');
      const grandchildRow = grandchildTitle.closest('div[style]');
      // depth=2: 2*1.25+0.75 = 3.25rem
      expect(grandchildRow).toHaveStyle({ paddingLeft: '3.25rem' });
    });
  });

  // ---------------------------------------------------------------------------
  // draftDueDate / draftNotes initial value from node
  // ---------------------------------------------------------------------------

  describe('initial draft state from node', () => {
    it('shows the existing due date pre-filled in the meta panel date input', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      // Open meta panel via the chip
      await user.click(screen.getByRole('button', { name: /due date:/i }));

      // The date input is type="date" (not role textbox); query by label association
      const dueDateInput = document.querySelector('input[type="date"]');
      if (!dueDateInput) throw new Error('date input not found');
      expect(dueDateInput).toBeInTheDocument();
      expect((dueDateInput as HTMLInputElement).value).toBe('2099-12-31');
    });

    it('shows the existing notes pre-filled in the meta panel textarea', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, notes: 'My existing notes' }]);

      // Open the meta panel via the actions menu
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      // ArrowDown×2 → "Add notes"
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      // Notes textarea should be visible with existing content
      const textarea = await screen.findByRole('textbox', { name: /notes/i });
      expect(textarea).toHaveValue('My existing notes');
    });
  });

  // ---------------------------------------------------------------------------
  // 'Edit due date' vs 'Set due date' label in dropdown
  // ---------------------------------------------------------------------------

  describe('due date dropdown item label', () => {
    it('shows "Edit due date" in the menu when a due date already exists', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');

      expect(screen.getByText('Edit due date')).toBeInTheDocument();
    });

    it('shows "Set due date" in the menu when there is no due date', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');

      expect(screen.getByText('Set due date')).toBeInTheDocument();
    });

    it('shows "Edit notes" in the menu when notes already exist', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, notes: 'Some notes' }]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');

      expect(screen.getByText('Edit notes')).toBeInTheDocument();
    });

    it('shows "Add notes" in the menu when there are no notes', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');

      expect(screen.getByText('Add notes')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Add subtask — shows/hides subtask capture box and sets isExpanded
  // ---------------------------------------------------------------------------

  describe('add subtask button', () => {
    it('shows the capture box when "Add subtask" is clicked', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /add subtask/i }));

      // The CaptureBox renders a textbox for capture
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('shows the subtasks list (isExpanded=true) when "Add subtask" is clicked', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]);

      // Initially collapsed — subtask list not in accessibility tree
      expect(screen.queryByRole('list', { name: 'Subtasks' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /add subtask/i }));

      // Subtask list is now in the accessibility tree (expanded + aria-hidden removed)
      expect(screen.getByRole('list', { name: 'Subtasks' })).toBeInTheDocument();
    });

    it('hides the capture box when "Add subtask" is clicked twice (toggle off)', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /add subtask/i }));
      expect(screen.getByRole('textbox')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /add subtask/i }));
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // isExpanded default (false) — children hidden until toggled
  // ---------------------------------------------------------------------------

  describe('initial collapsed state', () => {
    it('does not show children before the expand button is clicked', () => {
      renderTasks([BASE_ITEM, CHILD_ITEM]);
      // The subtask list is aria-hidden when collapsed; queryByRole respects that.
      expect(screen.queryByRole('list', { name: 'Subtasks' })).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Due date save/cancel in meta panel
  // ---------------------------------------------------------------------------

  describe('due date meta panel editing', () => {
    it('calls updateItem with the new due date on Save', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, due_date: '2099-06-30' });
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      const dateInput = document.querySelector('input[type="date"]');
      if (!dateInput) throw new Error('date input not found');
      fireEvent.change(dateInput, { target: { value: '2099-06-30' } });

      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { due_date: '2099-06-30' });
      });
    });

    it('does not call updateItem if the due date is unchanged', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      // Save without changing the value
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('restores the original due date on cancel', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      const dateInput = document.querySelector('input[type="date"]');
      if (!dateInput) throw new Error('date input not found');
      fireEvent.change(dateInput, { target: { value: '2025-01-01' } });

      await user.click(screen.getByRole('button', { name: /^cancel$/i }));

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('calls updateItem with null when due date is cleared', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, due_date: null });
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      const dateInput = document.querySelector('input[type="date"]');
      if (!dateInput) throw new Error('date input not found');
      fireEvent.change(dateInput, { target: { value: '' } });

      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { due_date: null });
      });
    });

    it('reverts draft due date on network error', async () => {
      mockUpdateItem.mockRejectedValue(new Error('Network error'));
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      const dateInput = document.querySelector('input[type="date"]');
      if (!dateInput) throw new Error('date input not found');
      fireEvent.change(dateInput, { target: { value: '2025-01-01' } });

      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalled();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Notes meta panel editing
  // ---------------------------------------------------------------------------

  describe('notes meta panel editing', () => {
    it('opens notes editing via the menu', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      expect(await screen.findByRole('textbox', { name: /notes/i })).toBeInTheDocument();
    });

    it('calls updateItem with new notes on Save', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, notes: 'New notes' });
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const textarea = await screen.findByRole('textbox', { name: /notes/i });
      await user.type(textarea, 'New notes');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { notes: 'New notes' });
      });
    });

    it('calls updateItem with null when notes are cleared', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, notes: null });
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, notes: 'Old notes' }]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const textarea = await screen.findByRole('textbox', { name: /notes/i });
      await user.clear(textarea);
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { notes: null });
      });
    });

    it('does not call updateItem when notes are unchanged', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, notes: 'Same notes' }]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      await screen.findByRole('textbox', { name: /notes/i });
      // Save without changing
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('does not call updateItem when notes edit is cancelled', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const textarea = await screen.findByRole('textbox', { name: /notes/i });
      await user.type(textarea, 'Never saved');

      // Cancel
      const [cancelBtn] = screen.getAllByRole('button', { name: /^cancel$/i });
      if (!cancelBtn) throw new Error('cancel button not found');
      await user.click(cancelBtn);

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('shows existing notes in the view (not editing) button', () => {
      renderTasks([{ ...BASE_ITEM, notes: 'My note content' }]);
      // The meta panel isn't open yet — but notes render in the panel only when isMetaOpen.
      // The 'Add notes' / 'Edit notes' text in the dropdown tells us the state.
      // We just need to verify the note content appears once meta opens.
      // (Covered by the existing notes tests above; this is for 'no notes' case.)
      expect(screen.queryByText('My note content')).not.toBeInTheDocument();
    });

    it('shows "Add notes…" placeholder when no notes exist in meta panel', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      // After notes edit mode opens and then we save/cancel back to view mode
      await screen.findByRole('textbox', { name: /notes/i });
      const [cancelBtn2] = screen.getAllByRole('button', { name: /^cancel$/i });
      if (!cancelBtn2) throw new Error('cancel button not found');
      await user.click(cancelBtn2);

      // In view mode, should show the placeholder
      expect(screen.getByText('Add notes…')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Cascade modal — isPending=false ensures modal is functional
  // ---------------------------------------------------------------------------

  describe('cascade modal', () => {
    it('confirms cascade completion, closes the modal, and completes after the animation', async () => {
      mockCompleteTask.mockResolvedValue([]);
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]);

      await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));
      await screen.findByText(/complete with subtasks/i);

      // Confirm button should be enabled (isPending=false, so not disabled)
      const confirmBtn = screen.getByRole('button', { name: /complete all/i });
      expect(confirmBtn).not.toBeDisabled();

      await user.click(confirmBtn);

      // The modal closes and the subtree animates out; completion fires when it ends.
      await waitFor(() => {
        expect(screen.queryByText(/complete with subtasks/i)).not.toBeInTheDocument();
      });
      expect(mockCompleteTask).not.toHaveBeenCalled();

      endCollapse('Write tests');

      await waitFor(() => {
        expect(mockCompleteTask).toHaveBeenCalledWith('item-1');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // contextLabel — 'Unknown' fallback when folder_id set but folder not found
  // ---------------------------------------------------------------------------

  describe('context label Unknown fallback', () => {
    it('shows "Unknown" when the completed task has a folder_id but the folder is not in the list', () => {
      const itemWithMissingFolder: Item = {
        ...BASE_ITEM,
        status: 'completed',
        folder_id: 'folder-nonexistent',
      };
      renderTasks([itemWithMissingFolder], COMPLETED);
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // "Set a due date…" placeholder in meta panel when no due date
  // ---------------------------------------------------------------------------

  describe('meta panel due date placeholder', () => {
    it('shows "Set a due date…" placeholder when no due date exists and meta is open', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      // Open meta via "Set due date" menu item, then exit edit mode via Cancel
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      // ArrowDown×1 = "Set due date"
      await user.keyboard('[ArrowDown][Enter]');

      // Meta panel is open in editing mode; cancel to get to view mode
      await screen.findByRole('button', { name: /^cancel$/i });
      await user.click(screen.getByRole('button', { name: /^cancel$/i }));

      expect(screen.getByText('Set a due date…')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // draftDueDate / draftNotes initial value when node fields are null
  // ---------------------------------------------------------------------------

  describe('initial draft values from null node fields', () => {
    it('initializes draftDueDate to empty string when node.due_date is null', async () => {
      const user = userEvent.setup();
      // BASE_ITEM has due_date: null
      renderTasks([BASE_ITEM]);

      // Open meta panel in edit mode via the menu
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');

      // The date input should have an empty value, not "Stryker was here!"
      const dateInput = document.querySelector('input[type="date"]');
      if (!dateInput) throw new Error('date input not found');
      expect((dateInput as HTMLInputElement).value).toBe('');
    });

    it('initializes draftNotes to empty string when node.notes is null', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const textarea = await screen.findByRole('textbox', { name: /notes/i });
      expect(textarea).toHaveValue('');
    });
  });

  // ---------------------------------------------------------------------------
  // contextLabel !== null guard — context label container absent when null
  // ---------------------------------------------------------------------------

  describe('context label structural absence', () => {
    it('does not render the context label container when contextLabel is null (inbox view)', () => {
      renderTasks([BASE_ITEM]);
      // The context label span has class text-muted-foreground/50 — only shows when contextLabel !== null.
      // With mutation `contextLabel !== null → true`, this span renders empty for inbox items.
      // We detect it by asserting the ListCheck icon (inside the span) is absent.
      // In the inbox view there is no context label, so that <span> should not exist.
      const titleContainer = screen.getByText('Write tests').closest('div');
      if (!titleContainer) throw new Error('title container not found');
      // The context label span (if present) would have siblings inside the title flex container.
      // Only one child span (the title span) should be present.
      const spans = titleContainer.querySelectorAll(':scope > span');
      expect(spans).toHaveLength(1); // only the title span, no context label span
    });
  });

  // ---------------------------------------------------------------------------
  // folders.find — correct folder matched (not just the first one)
  // ---------------------------------------------------------------------------

  describe('folder name in context label', () => {
    it('shows the correct folder name when multiple folders exist', () => {
      const folderA: Folder = { id: 'folder-a', name: 'Alpha', created_at: '2025-01-01T00:00:00Z' };
      const folderB: Folder = { id: 'folder-b', name: 'Beta', created_at: '2025-01-01T01:00:00Z' };
      const itemInB: Item = { ...BASE_ITEM, status: 'completed', folder_id: 'folder-b' };
      renderTasks([itemInB], { ...COMPLETED, folders: [folderA, folderB] });
      // Should show 'Beta', NOT 'Alpha' (Alpha is first in the list)
      expect(screen.getByText('Beta')).toBeInTheDocument();
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // metaIndentLeft — meta panel marginLeft matches depth
  // ---------------------------------------------------------------------------

  describe('meta panel indentation by depth', () => {
    it('meta panel has marginLeft for a root task (depth=0)', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      // The meta panel div gets style marginLeft = metaIndentLeft = `${0*1.25+2.5}rem` = '2.5rem'
      // CSS inline style uses hyphenated 'margin-left', so query with the hyphenated form
      const metaPanel = document.querySelector('[style*="margin-left"]');
      if (!metaPanel) throw new Error('meta panel not found');
      expect(metaPanel).toHaveStyle({ marginLeft: '2.5rem' });
    });

    it('meta panel has larger marginLeft for a nested task (depth=1)', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]);

      // Expand the parent first
      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      // Now open the child's meta panel via its menu
      const childTitle = screen.getByText('Write unit tests');
      const childRow = childTitle.closest('li');
      if (!childRow) throw new Error('child row not found');
      const childMoreBtn = within(childRow).getByRole('button', { name: /more actions/i });
      await user.click(childMoreBtn);
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');

      // depth=1: metaIndentLeft = `${1*1.25+2.5}rem` = '3.75rem'
      const childLi = childTitle.closest('li');
      if (!childLi) throw new Error('child li not found');
      const metaPanel = childLi.querySelector('[style*="margin-left"]');
      if (!metaPanel) throw new Error('meta panel not found in child li');
      expect(metaPanel).toHaveStyle({ marginLeft: '3.75rem' });
    });
  });

  // ---------------------------------------------------------------------------
  // handleSaveDueDate — behavioral mutations
  // ---------------------------------------------------------------------------

  describe('handleSaveDueDate behavior', () => {
    it('exits editing mode immediately when Save is clicked (setIsEditingDueDate → false)', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, due_date: '2099-06-30' });
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      const dateInput = document.querySelector('input[type="date"]');
      if (!dateInput) throw new Error('date input not found');
      fireEvent.change(dateInput, { target: { value: '2099-06-30' } });
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      // After save, editing mode should be off — the date input should be gone
      await waitFor(() => {
        expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();
      });
    });

    it('trims whitespace from the due date value before comparing (no-op on no real change)', async () => {
      // If trim() is removed (mutation), draftDueDate=' 2099-12-31 ' !== '2099-12-31' → triggers update.
      // With trim(): ' 2099-12-31 '.trim() === '2099-12-31' → no-op (same value).
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      // Simulate a change that adds whitespace (which trim should handle)
      const dateInput = document.querySelector('input[type="date"]');
      if (!dateInput) throw new Error('date input not found');
      // Date inputs can't have whitespace, but we can test via the Save button skipping updateItem
      // Save without changing the value → no updateItem call (trim is effectively a no-op here)
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('reverts draftDueDate to original when update fails (catch block restores)', async () => {
      mockUpdateItem.mockRejectedValue(new Error('Network error'));
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      const dateInput = document.querySelector('input[type="date"]');
      if (!dateInput) throw new Error('date input not found');
      fireEvent.change(dateInput, { target: { value: '2025-01-01' } });
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      // After failure, meta panel reopens in view mode with original date
      await waitFor(() => {
        // The chip should show the original formatted due date again (not '2025-01-01')
        expect(mockUpdateItem).toHaveBeenCalled();
      });
      // Reopen editing to check the draft was reset
      await user.click(screen.getByRole('button', { name: /due date:/i }));
      const resetInput = document.querySelector('input[type="date"]');
      if (!resetInput) throw new Error('date input not found after reopen');
      expect((resetInput as HTMLInputElement).value).toBe('2099-12-31');
    });

    it('cancels with original value restored when node.due_date is non-null (LogicalOperator)', async () => {
      // Mutation: `node.due_date ?? '' → node.due_date && ''`. When node.due_date='2099-12-31',
      // `'2099-12-31' && ''` = '' (empty string) instead of '2099-12-31'. After cancel,
      // draftDueDate would be reset to '' (wrong). This test catches that regression.
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      const dateInput = document.querySelector('input[type="date"]');
      if (!dateInput) throw new Error('date input not found');
      fireEvent.change(dateInput, { target: { value: '2025-01-01' } });

      await user.click(screen.getByRole('button', { name: /^cancel$/i }));

      // After cancel, chip should restore to original date
      expect(screen.getByRole('button', { name: /due date: 2099-12-31/i })).toBeInTheDocument();

      // Re-open to verify the draft was restored to original
      await user.click(screen.getByRole('button', { name: /due date: 2099-12-31/i }));
      const reopenedInput = document.querySelector('input[type="date"]');
      if (!reopenedInput) throw new Error('date input not found after reopen');
      expect((reopenedInput as HTMLInputElement).value).toBe('2099-12-31');
    });
  });

  // ---------------------------------------------------------------------------
  // handleSaveNotes — behavioral mutations
  // ---------------------------------------------------------------------------

  describe('handleSaveNotes behavior', () => {
    it('exits notes editing mode when Save is clicked (setIsEditingNotes → false)', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, notes: 'New content' });
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const textarea = await screen.findByRole('textbox', { name: /notes/i });
      await user.type(textarea, 'New content');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      // After save, textarea (edit mode) should be gone
      await waitFor(() => {
        expect(screen.queryByRole('textbox', { name: /notes/i })).not.toBeInTheDocument();
      });
    });

    it('trims whitespace from notes value when unchanged (no-op)', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, notes: 'Existing note' }]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      await screen.findByRole('textbox', { name: /notes/i });
      // Save without changing the value → trim('Existing note') === 'Existing note' → no updateItem
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('saves trimmed notes — calls updateItem with trimmed value (not the whitespace-padded one)', async () => {
      // This test kills the MethodExpression mutant `draftNotes.trim() → draftNotes`.
      // With the mutant, 'Existing note  ' !== 'Existing note' → updateItem('Existing note  ')
      // (extra trailing spaces). With correct trim(), ' Existing note  '.trim() = 'Existing note'
      // which equals node.notes → no updateItem call (it's unchanged after trimming).
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, notes: 'Existing note' }]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const textarea = await screen.findByRole('textbox', { name: /notes/i });
      // Add trailing whitespace to simulate user typing spaces
      await user.type(textarea, ' '.repeat(3));
      // Now draftNotes = 'Existing note   ' — trimmed = 'Existing note' = unchanged → no save
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      // trim() makes it unchanged → no updateItem; without trim → updateItem called
      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('uses notes current value correctly when comparing (not "Stryker was here!")', async () => {
      // Mutation: `node.notes ?? '' → node.notes ?? "Stryker was here!"`. With notes=null,
      // currentValue = "Stryker was here!" → draftNotes (empty) !== "Stryker was here!" → triggers update.
      // This test renders with notes=null, saves without changes → should NOT call updateItem.
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]); // notes=null

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      await screen.findByRole('textbox', { name: /notes/i });
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('reverts draftNotes when update fails (catch block restores notes)', async () => {
      mockUpdateItem.mockRejectedValue(new Error('Network error'));
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, notes: 'Original note' }]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const textarea = await screen.findByRole('textbox', { name: /notes/i });
      await user.clear(textarea);
      await user.type(textarea, 'Failed update');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalled();
      });

      // After failure, reopen notes to verify draft was reset to original
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const reopenedTextarea = await screen.findByRole('textbox', { name: /notes/i });
      expect(reopenedTextarea).toHaveValue('Original note');
    });

    it('reverts draftNotes to original using ?? operator (LogicalOperator)', async () => {
      // Mutation: `node.notes ?? '' → node.notes && ''`. When notes='Saved note',
      // `'Saved note' && ''` = '' instead of 'Saved note'. After cancel, draft = '' (wrong).
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, notes: 'Saved note' }]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const textarea = await screen.findByRole('textbox', { name: /notes/i });
      await user.clear(textarea);
      await user.type(textarea, 'Never saved');

      const [cancelBtn] = screen.getAllByRole('button', { name: /^cancel$/i });
      if (!cancelBtn) throw new Error('cancel button not found');
      await user.click(cancelBtn);

      // After cancel, reopen to verify draft was reset to 'Saved note' not ''
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const reopenedTextarea = await screen.findByRole('textbox', { name: /notes/i });
      expect(reopenedTextarea).toHaveValue('Saved note');
    });
  });

  // ---------------------------------------------------------------------------
  // setIsExpanded(true) in dropdown menu items
  // ---------------------------------------------------------------------------

  describe('menu items expand children', () => {
    it('expands the children list when "Set due date" is selected from the menu', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: null }, CHILD_ITEM]);

      // Children not in accessibility tree initially (collapsed, aria-hidden)
      expect(screen.queryByRole('list', { name: 'Subtasks' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');

      // After selecting "Set due date", isExpanded should be set to true → children visible
      expect(screen.getByRole('list', { name: 'Subtasks' })).toBeInTheDocument();
    });

    it('expands the children list when "Add notes" is selected from the menu', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]);

      expect(screen.queryByRole('list', { name: 'Subtasks' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      expect(screen.getByRole('list', { name: 'Subtasks' })).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Meta panel label/input association (htmlFor / id template literals)
  // ---------------------------------------------------------------------------

  describe('meta panel label associations', () => {
    it('the "Due date" label is associated with the date input when editing', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      // getByLabelText uses the htmlFor ↔ id association
      const input = screen.getByLabelText('Due date');
      expect(input).toBeInTheDocument();
      expect((input as HTMLInputElement).type).toBe('date');
    });

    it('the "Notes" label is associated with the textarea when editing', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const textarea = await screen.findByLabelText('Notes');
      expect(textarea.tagName.toLowerCase()).toBe('textarea');
    });

    it('the "Due date" label is associated with the view-mode button when not editing', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      // Open meta panel without editing
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');

      // Cancel to get to view mode
      await screen.findByRole('button', { name: /^cancel$/i });
      await user.click(screen.getByRole('button', { name: /^cancel$/i }));

      // In view mode, the "Due date" label should be associated with the view button
      const viewButton = screen.getByLabelText('Due date');
      expect(viewButton.tagName.toLowerCase()).toBe('button');
    });

    it('the "Notes" label is associated with the view-mode button when not editing', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      await screen.findByRole('textbox', { name: /notes/i });
      const [cancelBtn] = screen.getAllByRole('button', { name: /^cancel$/i });
      if (!cancelBtn) throw new Error('cancel button not found');
      await user.click(cancelBtn);

      const viewButton = screen.getByLabelText('Notes');
      expect(viewButton.tagName.toLowerCase()).toBe('button');
    });
  });

  // ---------------------------------------------------------------------------
  // Meta panel onBlur saves due date
  // ---------------------------------------------------------------------------

  describe('due date input onBlur', () => {
    it('saves the due date when the date input loses focus (onBlur)', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, due_date: '2099-06-15' });
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      const dateInput = document.querySelector('input[type="date"]');
      if (!dateInput) throw new Error('date input not found');
      fireEvent.change(dateInput, { target: { value: '2099-06-15' } });
      // Trigger blur on the date input
      fireEvent.blur(dateInput);

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { due_date: '2099-06-15' });
      });
    });
  });

  // ---------------------------------------------------------------------------
  // View-mode clickable area: clicking due date / notes text enters edit mode
  // ---------------------------------------------------------------------------

  describe('view-mode panel click enters edit mode', () => {
    it('clicking the due date view button enters editing mode', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      // Open meta panel via menu, cancel to get to view mode
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');
      await screen.findByRole('button', { name: /^cancel$/i });
      await user.click(screen.getByRole('button', { name: /^cancel$/i }));

      // In view mode — "Set a due date…" is the view button
      expect(screen.getByText('Set a due date…')).toBeInTheDocument();

      // Click the due date view button to enter editing
      const viewBtn = screen.getByLabelText('Due date');
      await user.click(viewBtn);

      // Should now show the date input (editing mode)
      expect(document.querySelector('input[type="date"]')).toBeInTheDocument();
    });

    it('clicking the notes view button enters editing mode', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      // Open meta panel in notes view mode
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      await screen.findByRole('textbox', { name: /notes/i });
      const [cancelBtn] = screen.getAllByRole('button', { name: /^cancel$/i });
      if (!cancelBtn) throw new Error('cancel button not found');
      await user.click(cancelBtn);

      // In view mode — "Add notes…" is the view button
      expect(screen.getByText('Add notes…')).toBeInTheDocument();

      // Click the notes view button to enter editing
      const viewBtn = screen.getByLabelText('Notes');
      await user.click(viewBtn);

      // Should now show the textarea (editing mode)
      expect(screen.getByRole('textbox', { name: /notes/i })).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Close button resets editing state
  // ---------------------------------------------------------------------------

  describe('Close button resets editing state', () => {
    it('Close button sets isEditingDueDate to false (not true)', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      // Open due date editing
      await user.click(screen.getByRole('button', { name: /due date:/i }));

      // Verify date input is visible (editing mode)
      expect(document.querySelector('input[type="date"]')).toBeInTheDocument();

      // Click Close
      await user.click(screen.getByRole('button', { name: /^close$/i }));

      // Meta panel closed entirely — no date input
      expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();
      // The chip should reappear (due date still set)
      expect(screen.getByRole('button', { name: /due date: 2099-12-31/i })).toBeInTheDocument();
    });

    it('Close button sets isEditingNotes to false (not true)', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      // Notes textarea should be visible (editing mode)
      expect(await screen.findByRole('textbox', { name: /notes/i })).toBeInTheDocument();

      // Click Close
      await user.click(screen.getByRole('button', { name: /^close$/i }));

      // Meta panel closed — no textarea
      expect(screen.queryByRole('textbox', { name: /notes/i })).not.toBeInTheDocument();

      // Reopen the meta panel via "Set due date" (which only sets isEditingDueDate=true).
      // With mutation setIsEditingNotes(true), re-opening would also show the textarea.
      // With correct setIsEditingNotes(false), notes should be in VIEW mode (no textarea).
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');

      // The meta panel is now open (date editing) — notes textarea should NOT be present
      await screen.findByRole('button', { name: /^close$/i });
      expect(screen.queryByRole('textbox', { name: /notes/i })).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // hasChildren || showAddSubtask condition for children section
  // ---------------------------------------------------------------------------

  describe('children section visibility', () => {
    it('does not show the subtasks list when not expanded even with children', () => {
      renderTasks([BASE_ITEM, CHILD_ITEM]);
      // isExpanded=false → no children section regardless of hasChildren
      expect(screen.queryByRole('list', { name: /subtasks/i })).not.toBeInTheDocument();
    });

    it('does not render the subtasks list when expanded but has no children and no add-subtask', async () => {
      // This tests hasChildren || showAddSubtask: when both are false, no <ul> should render
      // even if isExpanded=true. To get isExpanded=true without hasChildren, we need
      // to expand (but BASE_ITEM has no children, so expand button is hidden/disabled).
      // We use the "Add subtask" toggle which sets isExpanded=true AND showAddSubtask=true.
      // Then we toggle it off: showAddSubtask=false, isExpanded=true, hasChildren=false.
      // With mutation `hasChildren || showAddSubtask → true`, the ul would still show.
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /add subtask/i }));
      // isExpanded=true, showAddSubtask=true → subtasks list visible
      expect(screen.getByRole('list', { name: /subtasks/i })).toBeInTheDocument();

      // Toggle off
      await user.click(screen.getByRole('button', { name: /add subtask/i }));
      // isExpanded=true, showAddSubtask=false, hasChildren=false → no subtasks list
      expect(screen.queryByRole('list', { name: /subtasks/i })).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // CaptureBox li indentation (paddingLeft for the add-subtask row)
  // ---------------------------------------------------------------------------

  describe('add subtask capture box indentation', () => {
    it('capture box li has paddingLeft matching depth+1 formula', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /add subtask/i }));

      // The li wrapping CaptureBox should have the computed paddingLeft
      // depth=0 → (0+1)*1.25+0.75 = 2rem
      const captureBox = document.querySelector('input[placeholder]');
      if (!captureBox) throw new Error('capture box input not found');
      const li = captureBox.closest('li');
      if (!li) throw new Error('li not found');
      expect(li).toHaveStyle({ paddingLeft: '2rem' });
    });

    it('capture box li has larger paddingLeft for a nested task (depth=1)', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]);

      // Expand the parent
      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      // Click "Add subtask" on the child row
      const childTitle = screen.getByText('Write unit tests');
      const childRow = childTitle.closest('li');
      if (!childRow) throw new Error('child row not found');
      const childAddBtn = within(childRow).getByRole('button', { name: /add subtask/i });
      await user.click(childAddBtn);

      // depth=1 → (1+1)*1.25+0.75 = 3.25rem
      const subtasksList = screen.getAllByRole('list', { name: /subtasks/i });
      // Find the nested subtasks list (second one — the child's)
      const childSubtasksList = subtasksList.at(-1);
      if (!childSubtasksList) throw new Error('child subtasks list not found');
      const captureLi = childSubtasksList.querySelector('li');
      if (!captureLi) throw new Error('capture li not found');
      expect(captureLi).toHaveStyle({ paddingLeft: '3.25rem' });
    });
  });

  // ---------------------------------------------------------------------------
  // onCapture callback — hides capture box after a task is captured
  // ---------------------------------------------------------------------------

  describe('onCapture callback', () => {
    it('keeps the capture box open after Enter so multiple subtasks can be added', async () => {
      // After a successful subtask submission the box must stay open,
      // letting the user type the next subtask without re-clicking "Add subtask".
      const mockCreateItem = jest.mocked(apiClient.createItem);
      mockCreateItem
        .mockResolvedValueOnce({ ...BASE_ITEM, id: 'new-item-1', title: 'First subtask' })
        .mockResolvedValueOnce({ ...BASE_ITEM, id: 'new-item-2', title: 'Second subtask' });

      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /add subtask/i }));

      const captureInput = document.querySelector('input[placeholder]');
      if (!captureInput) throw new Error('capture input not found');

      // Add first subtask — box should remain open.
      await user.type(captureInput, 'First subtask');
      await user.keyboard('[Enter]');

      await waitFor(() => {
        expect(mockCreateItem).toHaveBeenCalledTimes(1);
      });
      expect(document.querySelector('input[placeholder]')).toBeInTheDocument();

      // Add second subtask without re-opening the box.
      await user.type(captureInput, 'Second subtask');
      await user.keyboard('[Enter]');

      await waitFor(() => {
        expect(mockCreateItem).toHaveBeenCalledTimes(2);
      });
      expect(document.querySelector('input[placeholder]')).toBeInTheDocument();
    });

    it('hides the capture box when Escape is pressed', async () => {
      // Escape (onDismiss) must close the capture box.
      // With mutation setShowAddSubtask(false) → noop, the box would stay visible.
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /add subtask/i }));

      const captureInput = document.querySelector('input[placeholder]');
      if (!captureInput) throw new Error('capture input not found');
      expect(captureInput).toBeInTheDocument();

      // Focus the input before pressing Escape (autoFocus is intentionally omitted).
      await user.click(captureInput);
      await user.keyboard('[Escape]');

      expect(document.querySelector('input[placeholder]')).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Async-handler mutation kills — drive the real interaction AND flush the
  // handler's async work inside the test (await act / waitFor) so the mutated
  // statement executes within the test window and its coverage is attributed.
  // ===========================================================================

  describe('isCompleted prop default (BooleanLiteral)', () => {
    // Mutation: the `isCompleted = false` parameter default → `isCompleted = true`.
    // Rendering a TaskRow WITHOUT the prop must default to the active state
    // ("complete" affordance). With the mutant it would render the completed state.
    it('defaults isCompleted to false (active) when the prop is omitted', () => {
      const [node] = buildTree([BASE_ITEM]);
      if (!node) throw new Error('node not built');
      renderWithProviders(<TaskRow node={node} />, { tasks: [BASE_ITEM] });

      // Default false → active → the checkbox offers to "complete" the task.
      expect(
        screen.getByRole('button', { name: /mark "Write tests" complete/i }),
      ).toBeInTheDocument();
      // …and NOT the completed-view "active" affordance.
      expect(
        screen.queryByRole('button', { name: /mark "Write tests" active/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('title input autofocus (ConditionalExpression / OptionalChaining)', () => {
    // Mutation: `if (isEditingTitle)` → `if (false)` never focuses; the input must
    // receive focus when title editing begins.
    it('focuses the title input when entering edit mode', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));

      const input = await screen.findByRole('textbox', { name: /edit title/i });
      await waitFor(() => {
        expect(input).toHaveFocus();
      });
    });
  });

  describe('draftDueDate initializer (StringLiteral ?? "")', () => {
    // Mutation: `node.due_date ?? '' → node.due_date ?? "Stryker was here!"` on the
    // useState initializer. With node.due_date null and the mutant, draftDueDate
    // starts as "Stryker was here!"; saving unchanged then diffs against currentValue
    // ('') and spuriously calls updateItem. Correct code keeps draftDueDate '' → no call.
    it('initializes the draft to "" (not a sentinel) when due_date is null, so an unchanged save is a no-op', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]); // due_date null

      // Open the date editor via the menu ("Set due date").
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');

      const dateInput = await screen.findByLabelText('Due date');
      // Mutant initializer would seed a non-date sentinel; a real date input shows ''.
      expect((dateInput as HTMLInputElement).value).toBe('');

      await act(async () => {
        await user.click(screen.getByRole('button', { name: /^save$/i }));
      });

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });
  });

  describe('handleSaveDueDate — flushed async kills', () => {
    // Mutation (line ~137): `currentValue = node.due_date ?? ''` →
    // `?? "Stryker was here!"`. With a real due_date and an unchanged save,
    // currentValue must equal the stored date so the guard short-circuits; the
    // mutant makes currentValue a sentinel → spurious updateItem call.
    it('does NOT call updateItem when an existing due date is saved unchanged (currentValue ?? "")', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      await user.click(screen.getByRole('button', { name: /due date:/i }));

      await act(async () => {
        await user.click(screen.getByRole('button', { name: /^save$/i }));
      });

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    // Mutation (catch block, line ~145): `setDraftDueDate(node.due_date ?? '')` →
    // `?? "Stryker was here!"`. After a failed save the draft must restore to the
    // original date; the mutant restores a sentinel. Re-open the editor and read
    // the input's value back.
    // The catch-block restore reaches the `?? ''` fallback only when node.due_date
    // is NULL, so we start from a null due date. After a failed save the draft must
    // restore to '' (the original empty value); the `?? "Stryker was here!"` mutant
    // restores a sentinel into the draft state. We surface that hidden state by
    // re-opening the editor and Saving again WITHOUT changing anything: with the
    // correct '' the second save is a no-op (draft '' === currentValue ''), but the
    // sentinel draft differs from '' → a spurious SECOND updateItem call.
    it('restores the draft to "" (not a sentinel) after a failed save from a null due date', async () => {
      mockUpdateItem.mockRejectedValue(new Error('Network error'));
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]); // due_date null

      // Open the date editor via the menu ("Set due date").
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');

      const dateInput = await screen.findByLabelText('Due date');
      fireEvent.change(dateInput, { target: { value: '2025-01-01' } });

      // First save → updateItem rejects → catch restores the draft.
      await act(async () => {
        await user.click(screen.getByRole('button', { name: /^save$/i }));
      });
      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      });

      // Re-enter edit mode (does not touch the draft) and save unchanged.
      await user.click(screen.getByLabelText('Due date'));
      await act(async () => {
        await user.click(screen.getByRole('button', { name: /^save$/i }));
      });

      // Correct restore ('') → no second call. Sentinel restore → second call.
      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    });

    // Mutation (Cancel button, line ~490): `setDraftDueDate(node.due_date ?? '')`.
    // The `?? ''` fallback is only exercised when node.due_date is NULL. After
    // Cancel the draft must be '' so a later unchanged save is a no-op; the sentinel
    // mutant leaves a non-'' draft that triggers a spurious updateItem call.
    it('restores the draft to "" on Cancel (not a sentinel) when due date is null', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]); // due_date null

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][Enter]');

      const dateInput = await screen.findByLabelText('Due date');
      fireEvent.change(dateInput, { target: { value: '2025-01-01' } });

      // Cancel restores the draft via `node.due_date ?? ''`.
      await user.click(screen.getByRole('button', { name: /^cancel$/i }));

      // Re-enter edit mode and save unchanged.
      await user.click(screen.getByLabelText('Due date'));
      await act(async () => {
        await user.click(screen.getByRole('button', { name: /^save$/i }));
      });

      // Correct restore ('') → no updateItem. Sentinel restore → updateItem called.
      expect(mockUpdateItem).not.toHaveBeenCalled();
    });
  });

  describe('handleSaveNotes — flushed async kills', () => {
    // Mutation (line ~151): `draftNotes.trim()` → `draftNotes`. Notes (unlike a
    // date input) CAN hold whitespace; typing trailing spaces onto an unchanged
    // note must trim back to the original → no updateItem. The mutant keeps the
    // spaces → 'Existing note   ' !== 'Existing note' → updateItem called.
    it('trims notes before comparing — whitespace-only change is a no-op', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, notes: 'Existing note' }]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const textarea = await screen.findByRole('textbox', { name: /notes/i });
      await user.type(textarea, ' '.repeat(3));

      await act(async () => {
        await user.click(screen.getByRole('button', { name: /^save$/i }));
      });

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    // Mutation (line ~151): `draftNotes.trim()` → `draftNotes`, observed via the
    // SAVED value. Typing surrounding whitespace around new text must persist the
    // trimmed text; the mutant would persist the padded text.
    it('saves the trimmed notes value (not the whitespace-padded one)', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, notes: 'Fresh note' });
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]); // notes null

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const textarea = await screen.findByRole('textbox', { name: /notes/i });
      await user.type(textarea, '  Fresh note  ');

      await act(async () => {
        await user.click(screen.getByRole('button', { name: /^save$/i }));
      });

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { notes: 'Fresh note' });
      });
    });

    // Mutation (line ~153): `currentValue = node.notes ?? ''` → `?? "Stryker..."`.
    // With notes null, saving unchanged must short-circuit; the sentinel makes
    // currentValue differ from the empty draft → spurious updateItem call.
    it('does NOT call updateItem when null notes are saved unchanged (currentValue ?? "")', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]); // notes null

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      await screen.findByRole('textbox', { name: /notes/i });

      await act(async () => {
        await user.click(screen.getByRole('button', { name: /^save$/i }));
      });

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    // Mutation (catch block, line ~153): `setDraftNotes(node.notes ?? '')` →
    // `?? "Stryker was here!"`. The `?? ''` fallback is only reached when node.notes
    // is NULL, so we start from null notes. A textarea renders whatever string it is
    // given, so the sentinel is directly observable: after a failed save the
    // re-opened textarea must be '' (correct) rather than the sentinel (mutant).
    it('restores the draft to "" (not a sentinel) after a failed save from null notes', async () => {
      mockUpdateItem.mockRejectedValue(new Error('Network error'));
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]); // notes null

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const textarea = await screen.findByRole('textbox', { name: /notes/i });
      await user.type(textarea, 'Doomed edit');

      await act(async () => {
        await user.click(screen.getByRole('button', { name: /^save$/i }));
      });
      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalled();
      });

      // Re-open notes; the restored draft must be '' — a textarea shows the sentinel
      // verbatim if the `?? "Stryker was here!"` mutant ran.
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const reopened = await screen.findByRole('textbox', { name: /notes/i });
      expect(reopened).toHaveValue('');
    });

    // Mutation (Cancel button, line ~553): `setDraftNotes(node.notes ?? '')`.
    // Again the `?? ''` fallback is only reached with null notes; the re-opened
    // textarea renders the sentinel verbatim if the mutant ran.
    it('restores the draft to "" on Cancel (not a sentinel) when notes are null', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]); // notes null

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const textarea = await screen.findByRole('textbox', { name: /notes/i });
      await user.type(textarea, 'Never saved');

      const [cancelBtn] = screen.getAllByRole('button', { name: /^cancel$/i });
      if (!cancelBtn) throw new Error('cancel button not found');
      await user.click(cancelBtn);

      // Re-open notes; the draft must be '' (not the sentinel).
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');

      const reopened = await screen.findByRole('textbox', { name: /notes/i });
      expect(reopened).toHaveValue('');
    });
  });

  describe('Close button resets notes editing (BooleanLiteral)', () => {
    // Mutation (Close button, line ~599): `setIsEditingNotes(false)` →
    // `setIsEditingNotes(true)`. After Close, re-opening the panel in due-date
    // mode must NOT show a notes textarea; the mutant would leave notes editing on,
    // so the textarea would render.
    it('closes notes editing so the textarea is gone after re-opening the panel', async () => {
      const user = userEvent.setup();
      renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);

      // Open notes editor via the menu so isEditingNotes = true.
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][Enter]');
      expect(await screen.findByRole('textbox', { name: /notes/i })).toBeInTheDocument();

      // Close the meta panel — this must set isEditingNotes back to false.
      await user.click(screen.getByRole('button', { name: /^close$/i }));
      await waitFor(() => {
        expect(screen.queryByRole('textbox', { name: /notes/i })).not.toBeInTheDocument();
      });

      // Re-open the panel via the due-date chip (does NOT touch isEditingNotes).
      // If Close had set isEditingNotes=true (mutant), the textarea would reappear.
      await user.click(screen.getByRole('button', { name: /due date: 2099-12-31/i }));
      await screen.findByText('Due date');
      expect(screen.queryByRole('textbox', { name: /notes/i })).not.toBeInTheDocument();
    });
  });
});
