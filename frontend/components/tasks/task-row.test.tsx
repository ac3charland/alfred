import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { todayISODate } from '@/lib/date-utils';
import type { TaskScope } from '@/lib/stores/tasks-store';
import { renderWithProviders } from '@/lib/test-utils';
import { buildTree } from '@/lib/tree';
import type { Epic, Folder, Item, Project } from '@/lib/types';

import { TaskList } from './task-list';
import { TaskRow } from './task-row';

// api-client is the seam the store calls; mock it so tests never hit the network.
jest.mock('@/lib/api-client');
const mockCompleteTask = jest.mocked(apiClient.completeTask);
const mockUpdateItem = jest.mocked(apiClient.updateItem);
const mockDeleteItem = jest.mocked(apiClient.deleteItem);
const mockMoveToInbox = jest.mocked(apiClient.moveToInbox);
// The gate (GateDialog) reads projects/epics from the CodeProvider and routes the send
// through the store's convertTaskToCode, which calls enterCodeModule under the hood.
const mockEnterCodeModule = jest.mocked(apiClient.enterCodeModule);

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
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
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

// A second root inbox item, for the "only one inline input open at a time" cross-row tests.
const SECOND_ITEM: Item = {
  ...BASE_ITEM,
  id: 'item-9',
  title: 'Second task',
  created_at: '2025-01-01T09:00:00Z',
};

const COMPLETED_ITEM: Item = { ...BASE_ITEM, status: 'completed' };
const COMPLETED_FOLDER_ITEM: Item = { ...BASE_ITEM, status: 'completed', folder_id: 'folder-1' };

const FOLDER: Folder = { id: 'folder-1', name: 'Work', created_at: '2025-01-01T09:00:00Z' };

/**
 * Render rows through TaskList, seeding the flat item list into the store. Rows come from
 * the scoped selector, so changing an item's status/folder (complete/move) filters it out
 * of the view — exactly as in the app. Defaults to the inbox view.
 */
function renderTasks(
  items: Item[],
  options: { folders?: Folder[]; scope?: TaskScope; projects?: Project[]; epics?: Epic[] } = {},
) {
  return renderWithProviders(<TaskList scope={options.scope ?? { type: 'inbox' }} />, {
    tasks: items,
    folders: options.folders ?? [],
    projects: options.projects ?? [],
    epics: options.epics ?? [],
  });
}

const COMPLETED = { scope: { type: 'completed' } as const };

/** The <li> for the root row carrying `title`, for scoping within() queries. */
function rowFor(title: string): HTMLElement {
  const li = screen.getByText(title).closest('li');
  if (!li) throw new Error(`no row found for "${title}"`);
  return li;
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

/**
 * Activate a top-level actions-menu item by its accessible name, order-independently.
 * Radix portals the menu and sets `pointer-events:none` on the body, so `user.click()`
 * on a portal item is blocked — keyboard nav is the way in. The menu's exact item order
 * shifts as items gate on item_type (e.g. the "Convert to Code Story…" entry), so this
 * presses ArrowDown until the wanted item has focus rather than counting positions.
 *
 * Assumes the menu is already open (the caller clicked "More actions" and awaited the
 * menu). Throws if the item never gains focus within the menu's length.
 */
async function activateMenuItem(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
): Promise<void> {
  const target = screen.getByRole('menuitem', { name });
  // Cap the walk at the number of menu items so a missing item fails fast.
  const itemCount = screen.getAllByRole('menuitem').length;
  for (let index = 0; index < itemCount; index += 1) {
    if (document.activeElement === target) break;
    await user.keyboard('[ArrowDown]');
  }
  expect(target).toHaveFocus();
  await user.keyboard('[Enter]');
}

/** Open a row's actions menu and choose "Delete". */
async function chooseDelete(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /more actions/i }));
  await screen.findByRole('menu');
  await activateMenuItem(user, /^delete$/i);
}

/**
 * Focus a submenu trigger by name (order-independently, like `activateMenuItem`) and open
 * it with ArrowRight, leaving its first item focused. Returns once the submenu is open.
 */
async function openSubmenu(user: ReturnType<typeof userEvent.setup>, name: RegExp): Promise<void> {
  const trigger = screen.getByRole('menuitem', { name });
  const itemCount = screen.getAllByRole('menuitem').length;
  for (let index = 0; index < itemCount; index += 1) {
    if (document.activeElement === trigger) break;
    await user.keyboard('[ArrowDown]');
  }
  expect(trigger).toHaveFocus();
  await user.keyboard('[ArrowRight]');
}

// ---------------------------------------------------------------------------
// Due-date helpers
// ---------------------------------------------------------------------------

/**
 * Returns a YYYY-MM-DD string for the given local calendar date. After the
 * parseDueDate fix in date-utils, YYYY-MM-DD strings are treated as local
 * midnight, so no UTC-offset adjustment is needed here.
 */
function localDueDate(year: number, month0: number, day: number): string {
  return `${String(year)}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

/**
 * Today's local calendar date as a date-only YYYY-MM-DD string — the exact format the
 * DB stores due dates in. parseDueDate reads it as local midnight, which lands it in the
 * "due today" band (unlike a full datetime, which reads as a later moment on the same day).
 */
function todayLocalYMD(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  it('expand/collapse toggle reserves no space on mobile when there are no children', () => {
    renderTasks([BASE_ITEM]);
    const toggle = screen.getByRole('button', { name: /expand subtasks/i });
    // Mobile: removed from layout entirely (not just invisible), so the title shifts left.
    expect(toggle).toHaveClass('hidden');
    // md+: still an invisible spacer, keeping titles aligned across rows (desktop unchanged).
    expect(toggle).toHaveClass('md:invisible');
  });

  it('expand toggle is visible and reserves its column when node has children', () => {
    renderTasks([BASE_ITEM, CHILD_ITEM]);
    const toggle = screen.getByRole('button', { name: /expand subtasks/i });
    expect(toggle).not.toHaveClass('hidden');
    expect(toggle).not.toHaveClass('invisible');
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
  // Editing a parent's metadata opens the meta panel (a sibling of the subtree), so it
  // must NOT expand the subtask tree. Only "Add subtask" — whose form lives inside the
  // subtree — expands it.
  // ---------------------------------------------------------------------------

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
    mockCompleteTask.mockResolvedValue({ completed: [], spawned: null });
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
    mockCompleteTask.mockResolvedValue({ completed: [], spawned: null });
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it('does not let an unrelated transition on the wrapper commit the completion', async () => {
    mockCompleteTask.mockResolvedValue({ completed: [], spawned: null });
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));
    // Only the grid-template-rows transition commits — a different property must not.
    fireTransitionEnd(collapseWrapperFor('Write tests'), 'opacity');

    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it('does not let a child transition (e.g. the title colour fade) commit the completion', async () => {
    mockCompleteTask.mockResolvedValue({ completed: [], spawned: null });
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    const checkbox = screen.getByRole('button', { name: /mark "Write tests" complete/i });
    await user.click(checkbox);
    // A child's transitionend bubbles to the wrapper; only the wrapper's own collapse counts.
    fireTransitionEnd(checkbox, 'grid-template-rows');

    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it('calls completeTask and removes the task once the collapse transition ends', async () => {
    mockCompleteTask.mockResolvedValue({ completed: [], spawned: null });
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
      mockCompleteTask.mockResolvedValue({ completed: [], spawned: null });
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

  it('skips the cascade modal and completes directly when every descendant is already completed', async () => {
    // A parent whose only subtask is already completed: completing it cascades nothing new,
    // so there is nothing to warn about (ALF-73).
    mockReducedMotion(true);
    const completedChild: Item = { ...CHILD_ITEM, status: 'completed' };
    const user = userEvent.setup();
    renderTasks([BASE_ITEM, completedChild]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

    expect(screen.queryByText(/complete with subtasks/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockCompleteTask).toHaveBeenCalledWith('item-1');
    });
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

  it('opens the calendar from the row due-date chip and auto-saves a pick (ALF-94)', async () => {
    mockUpdateItem.mockResolvedValue(BASE_ITEM);
    const user = userEvent.setup();
    renderTasks([{ ...BASE_ITEM, due_date: '2025-07-02' }]);

    // The row badge itself is now clickable — no need to open the detail panel first.
    await user.click(screen.getByRole('button', { name: 'Due date: 2025-07-02' }));
    await user.click(await screen.findByRole('button', { name: 'July 10, 2025' }));

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { due_date: '2025-07-10' });
    });
  });

  // ---------------------------------------------------------------------------
  // Deletion — animate-then-commit (same exit mechanism as completion). Choosing
  // "Delete" fades the row out and collapses its height (pulling the rows below up);
  // deleteItem only fires once that collapse transition ends. jsdom doesn't run CSS
  // transitions, so we drive the collapse's transitionend by hand (endCollapse). Under
  // reduced motion there's no animation, so deletion is immediate.
  // ---------------------------------------------------------------------------

  it('fades the row out and does NOT call deleteItem until the collapse ends', async () => {
    mockDeleteItem.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await chooseDelete(user);

    // The row is still present, animating out (fading + collapsing), not removed yet.
    expect(screen.getByText('Write tests')).toBeInTheDocument();
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  it('deletes the task once the collapse transition ends', async () => {
    mockDeleteItem.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await chooseDelete(user);
    endCollapse('Write tests');

    await waitFor(() => {
      expect(mockDeleteItem).toHaveBeenCalledWith('item-1');
    });
    expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
  });

  it('does not let an unrelated transition on the wrapper commit the deletion', async () => {
    mockDeleteItem.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await chooseDelete(user);
    // The fade is an opacity transition that bubbles up — only grid-template-rows commits.
    fireTransitionEnd(collapseWrapperFor('Write tests'), 'opacity');

    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  it('restores the task when deleteItem fails after the animation', async () => {
    mockDeleteItem.mockRejectedValue(new Error('Network error'));
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await chooseDelete(user);
    endCollapse('Write tests');

    expect(await screen.findByText('Write tests')).toBeInTheDocument();
  });

  it('deletes immediately on choose under reduced motion, with no animation to wait on', async () => {
    mockReducedMotion(true);
    mockDeleteItem.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await chooseDelete(user);

    await waitFor(() => {
      expect(mockDeleteItem).toHaveBeenCalledWith('item-1');
    });
    expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
  });

  describe('move to folder', () => {
    // Radix DropdownMenu portals set pointer-events:none on the body, which blocks
    // userEvent.click() on portal items. Keyboard navigation bypasses this; the helpers
    // (activateMenuItem / openSubmenu) walk by item NAME so they're robust to the menu's
    // type-gated ordering. Inside the open "Move to…" submenu, "Inbox" is auto-focused;
    // ArrowDown → the first folder.

    it('calls updateItem once when moving a leaf task to a folder', async () => {
      mockUpdateItem.mockResolvedValue(BASE_ITEM);
      const user = userEvent.setup();
      renderTasks([BASE_ITEM], { folders: [FOLDER] });

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await openSubmenu(user, /move to…/i);
      await user.keyboard('[ArrowDown][Enter]');

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
      await openSubmenu(user, /move to…/i);
      await user.keyboard('[ArrowDown][Enter]');

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
      await openSubmenu(user, /move to…/i);
      await user.keyboard('[Enter]');

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
      await openSubmenu(user, /move to…/i);
      await user.keyboard('[Enter]');

      await waitFor(() => {
        expect(mockMoveToInbox).toHaveBeenCalledTimes(3);
      });
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-3');
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-2');
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-1');
    });
  });

  // ---------------------------------------------------------------------------
  // Drag handle removed — the whole row is now the drag surface (see the dnd-kit skill).
  // The drag/re-parent behaviour itself is covered by the pure resolvers + the e2e suite,
  // since jsdom can't measure layout to drive a real drag.
  // ---------------------------------------------------------------------------

  describe('drag handle', () => {
    it('no longer renders a separate grip/drag handle button on a top-level row', () => {
      renderTasks([BASE_ITEM]);
      expect(screen.queryByRole('button', { name: /to a folder/i })).not.toBeInTheDocument();
    });

    it('does not render a drag handle on a subtask row either', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]);

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      expect(screen.queryByRole('button', { name: /to a folder/i })).not.toBeInTheDocument();
    });

    it('makes the title non-highlightable so a press-drag on it lifts the row', () => {
      // The whole row is the drag surface, so the title text must not be selectable —
      // select-none stops a press-drag on it from highlighting text instead of dragging.
      renderTasks([BASE_ITEM]);
      expect(screen.getByText('Write tests').closest('div')).toHaveClass('select-none');
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

    it('exits edit mode and shows the new title immediately, before the server responds', async () => {
      // A never-resolving update keeps the request in flight for the assertion window, so
      // the editor must close and the new title show from the optimistic store patch alone
      // — never from awaiting the server (matching the due-date / notes interactions).
      mockUpdateItem.mockImplementation(() => new Promise(() => {}));
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'Optimistic title');
      await user.keyboard('[Enter]');

      expect(screen.getByText('Optimistic title')).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: /edit title/i })).not.toBeInTheDocument();
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { title: 'Optimistic title' });
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

      // Edit mode exits immediately (optimistic); the store rolls back the failed update,
      // so the original title is shown again and no edit input remains.
      expect(await screen.findByText('Write tests')).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: /edit title/i })).not.toBeInTheDocument();
    });

    it('shows an error toast and reverts the title when the save fails (ALF-33)', async () => {
      // The full path: a failed write rolls the optimistic title back (store) AND surfaces a
      // human-readable toast in the aria-live viewport (store → ToastProvider → screen).
      mockUpdateItem.mockRejectedValue(new Error('API PATCH /api/items/item-1 failed: 500 boom'));
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'Broken title');
      await user.keyboard('[Enter]');

      // The toast appears with the friendly copy — never the raw HTTP error.
      expect(await screen.findByText("Couldn't save changes")).toBeInTheDocument();
      expect(screen.queryByText(/500/)).not.toBeInTheDocument();
      // The optimistic title reverts to the original.
      expect(screen.getByText('Write tests')).toBeInTheDocument();
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

    it('dismisses and reverts the title when focus moves outside the edit area', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'Draft that gets abandoned');

      await user.click(document.body);

      expect(screen.queryByRole('textbox', { name: /edit title/i })).not.toBeInTheDocument();
      expect(screen.getByText('Write tests')).toBeInTheDocument();
      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('does not dismiss when clicking the confirm-title button (saves instead)', async () => {
      mockUpdateItem.mockResolvedValue({ id: 'item-1', title: 'New title' } as Awaited<
        ReturnType<typeof apiClient.updateItem>
      >);
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'New title');
      await user.click(screen.getByRole('button', { name: /confirm title/i }));

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { title: 'New title' });
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Priority chip (ALF-37)
  // ---------------------------------------------------------------------------

  describe('priority chip', () => {
    it('renders a priority badge for a top-level task with a level set', () => {
      renderTasks([{ ...BASE_ITEM, priority: 'high' }]);
      expect(screen.getByRole('button', { name: 'Priority: High' })).toBeInTheDocument();
    });

    it('renders no priority badge when the task is unprioritised', () => {
      renderTasks([{ ...BASE_ITEM, priority: null }]);
      expect(screen.queryByRole('button', { name: /^Priority:/ })).not.toBeInTheDocument();
    });

    it('renders a priority badge for a subtask with a level set (ALF-63)', async () => {
      const user = userEvent.setup();
      // Parent unprioritised, subtask Medium — so the only Priority chip is the subtask's.
      renderTasks([BASE_ITEM, { ...CHILD_ITEM, priority: 'medium' }]);
      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
      expect(screen.getByRole('button', { name: 'Priority: Medium' })).toBeInTheDocument();
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

  describe('due date urgency styling', () => {
    it('applies red (overdue) classes when the due date is in the past', () => {
      // 10 days ago is safely overdue in any timezone
      renderTasks([{ ...BASE_ITEM, due_date: dueForDayOffset(-10) }]);
      const chip = screen.getByRole('button', { name: /due date/i });
      expect(chip).toHaveClass('text-accent-red');
      expect(chip).not.toHaveClass('text-accent-amber', 'text-accent-blue');
    });

    it('applies amber (yellow) classes when the due date is today', () => {
      renderTasks([{ ...BASE_ITEM, due_date: todayLocalYMD() }]);
      const chip = screen.getByRole('button', { name: /due date/i });
      expect(chip).toHaveClass('text-accent-amber');
      expect(chip).not.toHaveClass('text-accent-red', 'text-accent-blue');
    });

    it('applies blue (upcoming) classes when the due date is in the future', () => {
      renderTasks([{ ...BASE_ITEM, due_date: dueForDayOffset(10) }]);
      const chip = screen.getByRole('button', { name: /due date/i });
      expect(chip).toHaveClass('text-accent-blue');
      expect(chip).not.toHaveClass('text-accent-red', 'text-accent-amber');
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

  // ---------------------------------------------------------------------------
  // Due date chip visibility — hidden when editing due date
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // isMetaOpen panel
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // 'Edit due date' vs 'Set due date' label in dropdown
  // ---------------------------------------------------------------------------

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
  // Add subtask from the ⋯ menu (mobile) — on mobile the inline "+" is hidden and its
  // affordance collapses into the dot menu's leading "Add subtask" item (ALF-118). The item
  // is `md:hidden` (desktop keeps the visible "+", so the menu never doubles up), task-rows
  // only, and opens the same inline capture box the "+" does.
  // ---------------------------------------------------------------------------

  describe('add subtask from the ⋯ menu (mobile)', () => {
    it('opens the capture box and expands the subtree from the menu "Add subtask" item', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]);

      // Collapsed to start — the subtree isn't in the accessibility tree yet.
      expect(screen.queryByRole('list', { name: 'Subtasks' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await activateMenuItem(user, /^add subtask$/i);

      // Same result as the "+" button: the inline capture box opens and the subtree expands
      // so the field is visible inside it.
      expect(screen.getByPlaceholderText(/add subtask/i)).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Subtasks' })).toBeInTheDocument();
    });

    it('renders the menu "Add subtask" item as mobile-only (md:hidden)', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');

      // Desktop keeps the visible "+", so this menu entry is hidden at md+ to avoid doubling up.
      expect(screen.getByRole('menuitem', { name: 'Add subtask' })).toHaveClass('md:hidden');
    });
  });

  // ---------------------------------------------------------------------------
  // Add-subtask field entry/exit animation (ALF-66) — the field grows in with a
  // fade when opened and shrinks back out, staying mounted through its exit so the
  // collapse can play, then unmounting on the animation's end.
  // ---------------------------------------------------------------------------

  describe('add subtask field animation', () => {
    it('grows the field in with a height-grow + fade when opened', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /add subtask/i }));

      const reveal = screen.getByTestId('animated-height-reveal');
      // The field's wrapper plays the expand (not collapse) keyframe and contains the input.
      expect(reveal).toHaveClass('animate-expand-y');
      expect(reveal).not.toHaveClass('animate-collapse-y');
      expect(within(reveal).getByPlaceholderText(/add subtask/i)).toBeInTheDocument();
    });

    it('plays the collapse keyframe and stays mounted while it shrinks out on dismiss', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /add subtask/i }));
      // Toggle off — the field is now closing, but still mounted so the exit can animate.
      await user.click(screen.getByRole('button', { name: /add subtask/i }));

      const reveal = screen.getByTestId('animated-height-reveal');
      expect(reveal).toHaveClass('animate-collapse-y');
      expect(reveal).not.toHaveClass('animate-expand-y');
      // The input is still in the DOM mid-exit (queryable by placeholder, not by role — the
      // closing region is aria-hidden).
      expect(screen.getByPlaceholderText(/add subtask/i)).toBeInTheDocument();

      // Once the collapse animation ends, the field unmounts.
      act(() => {
        fireEvent.animationEnd(reveal);
      });
      expect(screen.queryByPlaceholderText(/add subtask/i)).not.toBeInTheDocument();
    });

    it('unmounts the field immediately on dismiss under reduced motion (no animation to wait on)', async () => {
      mockReducedMotion(true);
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /add subtask/i }));
      expect(screen.getByPlaceholderText(/add subtask/i)).toBeInTheDocument();

      // No animationEnd is fired, yet the field is gone right away.
      await user.click(screen.getByRole('button', { name: /add subtask/i }));
      expect(screen.queryByPlaceholderText(/add subtask/i)).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Single active inline input across rows
  //
  // Only ONE inline input may be open across all task rows: the title-edit text box
  // and the add-subtask entry box are mutually exclusive. Opening either closes
  // whatever another row had open, and an in-progress title edit is abandoned (never
  // saved) when another input takes over. (The Inbox hero capture box is exempt — it's
  // not rendered by TaskList, so these tests exercise only the row-level inputs.)
  // ---------------------------------------------------------------------------

  describe('single active inline input across rows', () => {
    it("closes one row's subtask entry box when another row opens its own", async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, SECOND_ITEM]);

      const [firstAdd, secondAdd] = screen.getAllByRole('button', { name: /add subtask/i });
      if (!firstAdd || !secondAdd) throw new Error('expected two add-subtask buttons');

      await user.click(firstAdd);
      expect(screen.getAllByPlaceholderText(/add subtask/i)).toHaveLength(1);

      await user.click(secondAdd);

      // Exactly one ACTIVE subtask entry box remains, and it belongs to the second row. The first
      // row's box is animating out (ALF-66) — still mounted but aria-hidden — so query by role,
      // which excludes the closing region, to assert it's no longer the active input.
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(within(rowFor('Write tests')).queryByRole('textbox')).not.toBeInTheDocument();
      expect(within(rowFor('Second task')).getByRole('textbox')).toBeInTheDocument();
    });

    it('abandons an in-progress title edit without saving when another title is double-clicked', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, SECOND_ITEM]);

      // Start editing the first item's title and type an unsaved change.
      await user.dblClick(screen.getByText('Write tests'));
      const firstInput = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(firstInput);
      await user.type(firstInput, 'Changed text');

      // Double-click the second item's title — the first edit is abandoned.
      await user.dblClick(screen.getByText('Second task'));

      const [activeInput, ...rest] = screen.getAllByRole('textbox', { name: /edit title/i });
      expect(rest).toHaveLength(0);
      expect(activeInput).toHaveValue('Second task');
      // The first row reverted to its original title; the typed change never persisted.
      expect(screen.getByText('Write tests')).toBeInTheDocument();
      expect(screen.queryByText('Changed text')).not.toBeInTheDocument();
      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('shows the current title (not the abandoned draft) when the edit is re-opened later', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, SECOND_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const firstInput = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(firstInput);
      await user.type(firstInput, 'Abandoned draft');

      // Take over with the second item, then come back to the first.
      await user.dblClick(screen.getByText('Second task'));
      await user.dblClick(screen.getByText('Write tests'));

      expect(screen.getByRole('textbox', { name: /edit title/i })).toHaveValue('Write tests');
    });

    it('closes an open title edit when an add-subtask box opens (cross-input exclusion)', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, SECOND_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      expect(screen.getByRole('textbox', { name: /edit title/i })).toBeInTheDocument();

      const [, secondAdd] = screen.getAllByRole('button', { name: /add subtask/i });
      if (!secondAdd) throw new Error('expected a second add-subtask button');
      await user.click(secondAdd);

      // The title edit is gone; the subtask entry box is the sole open input.
      expect(screen.queryByRole('textbox', { name: /edit title/i })).not.toBeInTheDocument();
      expect(screen.getAllByPlaceholderText(/add subtask/i)).toHaveLength(1);
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

  // ---------------------------------------------------------------------------
  // Notes meta panel editing
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Cascade modal — isPending=false ensures modal is functional
  // ---------------------------------------------------------------------------

  describe('cascade modal', () => {
    it('confirms cascade completion, closes the modal, and completes after the animation', async () => {
      mockCompleteTask.mockResolvedValue({ completed: [], spawned: null });
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

  // ---------------------------------------------------------------------------
  // draftDueDate / draftNotes initial value when node fields are null
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // handleSaveDueDate — behavioral mutations
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // handleSaveNotes — behavioral mutations
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Meta panel label/input association (htmlFor / id template literals)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Meta panel onBlur saves due date
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // View-mode clickable area: clicking due date / notes text enters edit mode
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Close button resets editing state
  // ---------------------------------------------------------------------------

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
      // This tests hasChildren || addSubtaskRendered: when both are false, no <ul> should render
      // even if isExpanded=true. To get isExpanded=true without hasChildren, we need
      // to expand (but BASE_ITEM has no children, so expand button is hidden/disabled).
      // We use the "Add subtask" toggle which sets isExpanded=true AND showAddSubtask=true.
      // Then we toggle it off: showAddSubtask=false, isExpanded=true, hasChildren=false.
      // With mutation `hasChildren || addSubtaskRendered → true`, the ul would still show.
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /add subtask/i }));
      // isExpanded=true, showAddSubtask=true → subtasks list visible
      expect(screen.getByRole('list', { name: /subtasks/i })).toBeInTheDocument();

      // Toggle off — the field animates out (ALF-66), so the container lingers until the
      // collapse animation ends. Drive that to completion, then the list unmounts.
      await user.click(screen.getByRole('button', { name: /add subtask/i }));
      act(() => {
        fireEvent.animationEnd(screen.getByTestId('animated-height-reveal'));
      });
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
      // depth=0 → (0+1)*1.25+2.5 = 3.75rem
      const captureBox = document.querySelector('input[placeholder]');
      if (!captureBox) throw new Error('capture box input not found');
      const li = captureBox.closest('li');
      if (!li) throw new Error('li not found');
      expect(li).toHaveStyle({ paddingLeft: '3.75rem' });
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

      // depth=1 → (1+1)*1.25+2.5 = 5rem
      const subtasksList = screen.getAllByRole('list', { name: /subtasks/i });
      // Find the nested subtasks list (second one — the child's)
      const childSubtasksList = subtasksList.at(-1);
      if (!childSubtasksList) throw new Error('child subtasks list not found');
      const captureLi = childSubtasksList.querySelector('li');
      if (!captureLi) throw new Error('capture li not found');
      expect(captureLi).toHaveStyle({ paddingLeft: '5rem' });
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

      // Escape dismisses, then the field animates out (ALF-66) and unmounts on collapse end.
      act(() => {
        fireEvent.animationEnd(screen.getByTestId('animated-height-reveal'));
      });
      expect(document.querySelector('input[placeholder]')).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Async-handler mutation kills — drive the real interaction AND flush the
  // handler's async work inside the test (await act / waitFor) so the mutated
  // statement executes within the test window and its coverage is attributed.
  // ===========================================================================

  describe('completion state derived from node.status', () => {
    // The checkbox affordance follows the node's own status, not the view: an active node
    // offers "complete", a completed node offers "active" — even without isCompletedView.
    it('renders the "complete" affordance for an active node', () => {
      const [node] = buildTree([BASE_ITEM]);
      if (!node) throw new Error('node not built');
      renderWithProviders(<TaskRow node={node} />, { tasks: [BASE_ITEM] });

      expect(
        screen.getByRole('button', { name: /mark "Write tests" complete/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /mark "Write tests" active/i }),
      ).not.toBeInTheDocument();
    });

    it('renders the "active" affordance for a completed node even without isCompletedView', () => {
      const [node] = buildTree([COMPLETED_ITEM]);
      if (!node) throw new Error('node not built');
      renderWithProviders(<TaskRow node={node} />, { tasks: [COMPLETED_ITEM] });

      expect(
        screen.getByRole('button', { name: /mark "Write tests" active/i }),
      ).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // "Show completed" — completed children tucked under an active parent
  // ---------------------------------------------------------------------------

  describe('show completed children', () => {
    const COMPLETED_CHILD: Item = {
      ...CHILD_ITEM,
      status: 'completed',
      completed_at: '2025-01-02T00:00:00Z',
    };
    const COMPLETED_GRANDCHILD: Item = {
      ...GRANDCHILD_ITEM,
      status: 'completed',
      completed_at: '2025-01-02T00:00:00Z',
    };

    it('hides completed children behind a "Show completed (N)" toggle when expanded', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, COMPLETED_CHILD]);

      // Completed child is not revealed yet (its list is aria-hidden).
      expect(screen.queryByRole('list', { name: 'Completed subtasks' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      expect(screen.getByRole('button', { name: 'Show completed (1)' })).toBeInTheDocument();
      // Still hidden until the toggle is clicked.
      expect(screen.queryByRole('list', { name: 'Completed subtasks' })).not.toBeInTheDocument();
    });

    it('counts only DIRECT completed children in the toggle label', async () => {
      const user = userEvent.setup();
      // item-1 → completed child → completed grandchild: one DIRECT completed child of item-1.
      renderTasks([BASE_ITEM, COMPLETED_CHILD, COMPLETED_GRANDCHILD]);

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      expect(screen.getByRole('button', { name: 'Show completed (1)' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /show completed \(2\)/i }),
      ).not.toBeInTheDocument();
    });

    it('reveals the completed children and switches the toggle to "Hide completed"', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, COMPLETED_CHILD]);

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
      await user.click(screen.getByRole('button', { name: 'Show completed (1)' }));

      expect(screen.getByRole('list', { name: 'Completed subtasks' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hide completed' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /show completed/i })).not.toBeInTheDocument();
    });

    it('renders a revealed completed child checked (teal) with low-contrast title', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, COMPLETED_CHILD]);

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
      await user.click(screen.getByRole('button', { name: 'Show completed (1)' }));

      const checkbox = screen.getByRole('button', { name: /mark "Write unit tests" active/i });
      expect(checkbox).toHaveClass('bg-accent-teal');
      expect(screen.getByText('Write unit tests')).toHaveClass('text-muted-foreground');
    });

    it('does not render a "Show completed" toggle when there are no completed children', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]); // both active

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      expect(screen.queryByRole('button', { name: /show completed/i })).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Completed-descendants badge — counts ALL completed descendants
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Unchecking a completed child pops it back to active
  // ---------------------------------------------------------------------------

  describe('unchecking a completed child', () => {
    const COMPLETED_CHILD: Item = {
      ...CHILD_ITEM,
      status: 'completed',
      completed_at: '2025-01-02T00:00:00Z',
    };

    it('reactivates the child and removes the "Show completed" toggle', async () => {
      mockUpdateItem.mockResolvedValue({
        ...COMPLETED_CHILD,
        status: 'active',
        completed_at: null,
      });
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, COMPLETED_CHILD]);

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
      await user.click(screen.getByRole('button', { name: 'Show completed (1)' }));

      await user.click(screen.getByRole('button', { name: /mark "Write unit tests" active/i }));

      // The child pops to the active list (offers "complete" again); no completed children
      // remain, so the toggle is gone.
      expect(
        await screen.findByRole('button', { name: /mark "Write unit tests" complete/i }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /show completed/i })).not.toBeInTheDocument();
    });

    it('reactivates a completed parent when its completed child is unchecked', async () => {
      // Root(active) → Parent(completed) → Child(completed). Unchecking Child must also
      // reactivate Parent (a completed parent can't keep an active child).
      mockUpdateItem.mockImplementation((id: string) =>
        Promise.resolve({
          ...BASE_ITEM,
          id,
          title: id === 'p' ? 'Parent' : 'Child',
          status: 'active',
          completed_at: null,
        }),
      );
      const root: Item = { ...BASE_ITEM, id: 'r', title: 'Root' };
      const parent: Item = {
        ...BASE_ITEM,
        id: 'p',
        title: 'Parent',
        parent_id: 'r',
        status: 'completed',
        completed_at: '2025-01-02T00:00:00Z',
        created_at: '2025-01-01T11:00:00Z',
      };
      const child: Item = {
        ...BASE_ITEM,
        id: 'c',
        title: 'Child',
        parent_id: 'p',
        status: 'completed',
        completed_at: '2025-01-02T00:00:00Z',
        created_at: '2025-01-01T12:00:00Z',
      };
      const user = userEvent.setup();
      renderTasks([root, parent, child]);

      // Reveal Parent under Root.
      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
      await user.click(screen.getByRole('button', { name: 'Show completed (1)' }));

      // Reveal Child under Parent (Parent's own expand + show-completed).
      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
      await user.click(screen.getByRole('button', { name: 'Show completed (1)' }));

      // Uncheck Child.
      await user.click(screen.getByRole('button', { name: 'Mark "Child" active' }));

      // Parent is reactivated → it now offers the "complete" affordance.
      expect(
        await screen.findByRole('button', { name: 'Mark "Parent" complete' }),
      ).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Completing an active child tucks it into the completed section
  // ---------------------------------------------------------------------------

  describe('completing an active child', () => {
    it('moves a completed leaf child into the "Show completed" section', async () => {
      mockCompleteTask.mockResolvedValue({
        completed: [{ ...CHILD_ITEM, status: 'completed' }],
        spawned: null,
      });
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]);

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
      // Child starts active in the subtask list.
      await user.click(screen.getByRole('button', { name: /mark "Write unit tests" complete/i }));
      // Completion commits when the row's collapse exit ends (jsdom: fire it by hand).
      endCollapse('Write unit tests');

      // It is now hidden behind the "Show completed (1)" toggle.
      expect(await screen.findByRole('button', { name: 'Show completed (1)' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /mark "Write unit tests" complete/i }),
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
});

// ---------------------------------------------------------------------------
// Classification & type-gating
//
// Capture creates `unclassified` items; `Classify as Task` unlocks the task-only
// affordances (checkbox, subtasks); `Classify as Code` shows the Code badge but still
// no task affordances. Only "Code" earns a row badge now (ALF-67 removed the "Task" pill).
// ---------------------------------------------------------------------------

const UNCLASSIFIED_ITEM: Item = { ...BASE_ITEM, item_type: 'unclassified' };
const CODE_ITEM: Item = { ...BASE_ITEM, item_type: 'code' };

describe('TaskRow — classification & type-gating', () => {
  describe('type badge', () => {
    it('shows no badge on an unclassified row', () => {
      renderTasks([UNCLASSIFIED_ITEM]);

      expect(screen.queryByText('Task')).not.toBeInTheDocument();
      expect(screen.queryByText('Code')).not.toBeInTheDocument();
    });

    // ALF-67: the "Task" pill is gone from every row (a parent task no longer shows one, on
    // top of ALF-65 already hiding it for subtasks / folder items). "Code" stays everywhere.
    it('shows no "Task" badge on a root task row', () => {
      renderTasks([BASE_ITEM]);

      expect(screen.queryByText('Task')).not.toBeInTheDocument();
    });

    it('shows a "Code" badge on a code row', () => {
      renderTasks([CODE_ITEM]);

      expect(screen.getByText('Code')).toBeInTheDocument();
    });

    it('shows no "Task" badge on a subtask row', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM]);

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      const subtaskRow = screen.getByText('Write unit tests').closest('li');
      expect(subtaskRow).not.toBeNull();
      expect(within(subtaskRow as HTMLElement).queryByText('Task')).not.toBeInTheDocument();
    });

    it('shows no "Task" badge for a task filed in a folder', () => {
      renderTasks([{ ...BASE_ITEM, folder_id: 'folder-1' }], {
        folders: [FOLDER],
        scope: { type: 'folder', folderId: 'folder-1' },
      });

      expect(screen.queryByText('Task')).not.toBeInTheDocument();
    });

    it('still shows the "Code" badge on a code subtask', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, { ...CHILD_ITEM, item_type: 'code' }]);

      await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

      const subtaskRow = screen.getByText('Write unit tests').closest('li');
      expect(subtaskRow).not.toBeNull();
      expect(within(subtaskRow as HTMLElement).getByText('Code')).toBeInTheDocument();
    });

    it('still shows the "Code" badge for a code item filed in a folder', () => {
      renderTasks([{ ...CODE_ITEM, folder_id: 'folder-1' }], {
        folders: [FOLDER],
        scope: { type: 'folder', folderId: 'folder-1' },
      });

      expect(screen.getByText('Code')).toBeInTheDocument();
    });
  });

  describe('the Classify as… submenu', () => {
    it('offers Classify as… only while the row is unclassified', async () => {
      const user = userEvent.setup();
      renderTasks([UNCLASSIFIED_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');

      expect(screen.getByRole('menuitem', { name: 'Classify as…' })).toBeInTheDocument();
    });

    it('hides Classify as… once the row is a task', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');

      expect(screen.queryByRole('menuitem', { name: 'Classify as…' })).not.toBeInTheDocument();
    });

    it('hides Classify as… once the row is code', async () => {
      const user = userEvent.setup();
      renderTasks([CODE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');

      expect(screen.queryByRole('menuitem', { name: 'Classify as…' })).not.toBeInTheDocument();
    });

    it('classifies as Task (item_type → task) and reveals the task affordances', async () => {
      mockUpdateItem.mockResolvedValue({ ...UNCLASSIFIED_ITEM, item_type: 'task' });
      const user = userEvent.setup();
      renderTasks([UNCLASSIFIED_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      // Drive the Radix submenu by keyboard (synthetic clicks race the safe-triangle):
      // hover the subtrigger, ArrowRight opens it (focusing "Task"), Enter selects.
      await user.hover(screen.getByRole('menuitem', { name: 'Classify as…' }));
      await user.keyboard('[ArrowRight]');
      await screen.findByRole('menuitem', { name: 'Task' });
      await user.keyboard('[Enter]');

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { item_type: 'task' });
      });
      // Optimistic flip: the completion checkbox now shows (a task carries no row pill).
      expect(
        screen.getByRole('button', { name: 'Mark "Write tests" complete' }),
      ).toBeInTheDocument();
    });

    it('classifies as Code (item_type → code) showing the Code badge but no checkbox', async () => {
      mockUpdateItem.mockResolvedValue({ ...UNCLASSIFIED_ITEM, item_type: 'code' });
      const user = userEvent.setup();
      renderTasks([UNCLASSIFIED_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.hover(screen.getByRole('menuitem', { name: 'Classify as…' }));
      await user.keyboard('[ArrowRight]');
      await screen.findByRole('menuitem', { name: 'Code' });
      // ArrowDown from "Task" to "Code", then select.
      await user.keyboard('[ArrowDown][Enter]');

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { item_type: 'code' });
      });
      expect(screen.getByText('Code')).toBeInTheDocument();
      // Still no task affordance after classifying as code.
      expect(
        screen.queryByRole('button', { name: /mark "Write tests" complete/i }),
      ).not.toBeInTheDocument();
    });

    it('rolls the item_type back if the classify request fails', async () => {
      mockUpdateItem.mockRejectedValue(new Error('network'));
      const user = userEvent.setup();
      renderTasks([UNCLASSIFIED_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.hover(screen.getByRole('menuitem', { name: 'Classify as…' }));
      await user.keyboard('[ArrowRight]');
      await screen.findByRole('menuitem', { name: 'Task' });
      await user.keyboard('[Enter]');

      // Optimistic badge appears, then the rollback removes it (back to unclassified).
      await waitFor(() => {
        expect(screen.queryByText('Task')).not.toBeInTheDocument();
      });
      expect(
        screen.queryByRole('button', { name: /mark "Write tests" complete/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('task-only affordances are gated', () => {
    it('an unclassified row exposes no completion checkbox', () => {
      renderTasks([UNCLASSIFIED_ITEM]);

      expect(
        screen.queryByRole('button', { name: /mark "Write tests" complete/i }),
      ).not.toBeInTheDocument();
    });

    it('a code row exposes no completion checkbox', () => {
      renderTasks([CODE_ITEM]);

      expect(
        screen.queryByRole('button', { name: /mark "Write tests" complete/i }),
      ).not.toBeInTheDocument();
    });

    it('a task row exposes the completion checkbox', () => {
      renderTasks([BASE_ITEM]);

      expect(
        screen.getByRole('button', { name: 'Mark "Write tests" complete' }),
      ).toBeInTheDocument();
    });

    it('an unclassified row reserves no checkbox space on mobile (spacer only at md+)', () => {
      renderTasks([UNCLASSIFIED_ITEM]);

      const spacer = rowFor('Write tests').querySelector('[data-testid="checkbox-spacer"]');
      // Mobile: the alignment spacer is dropped so the title shifts into the checkbox column.
      // md+: it reappears as a spacer, keeping titles aligned with checkboxed task rows.
      expect(spacer).toHaveClass('hidden', 'md:block');
    });

    it('a code row reserves no checkbox space on mobile (spacer only at md+)', () => {
      renderTasks([CODE_ITEM]);

      const spacer = rowFor('Write tests').querySelector('[data-testid="checkbox-spacer"]');
      expect(spacer).toHaveClass('hidden', 'md:block');
    });

    it('an unclassified row exposes no add-subtask affordance', () => {
      renderTasks([UNCLASSIFIED_ITEM]);

      expect(screen.queryByRole('button', { name: 'Add subtask' })).not.toBeInTheDocument();
    });

    it('a code row exposes no add-subtask affordance', () => {
      renderTasks([CODE_ITEM]);

      expect(screen.queryByRole('button', { name: 'Add subtask' })).not.toBeInTheDocument();
    });

    it('a task row exposes the add-subtask affordance', () => {
      renderTasks([BASE_ITEM]);

      expect(screen.getByRole('button', { name: 'Add subtask' })).toBeInTheDocument();
    });

    it('offers no ⋯-menu "Add subtask" item on an unclassified row', async () => {
      const user = userEvent.setup();
      renderTasks([UNCLASSIFIED_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      expect(screen.queryByRole('menuitem', { name: 'Add subtask' })).not.toBeInTheDocument();
    });

    it('offers no ⋯-menu "Add subtask" item on a code row', async () => {
      const user = userEvent.setup();
      renderTasks([CODE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      expect(screen.queryByRole('menuitem', { name: 'Add subtask' })).not.toBeInTheDocument();
    });

    it('offers the ⋯-menu "Add subtask" item on a task row (mobile affordance)', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      expect(screen.getByRole('menuitem', { name: 'Add subtask' })).toBeInTheDocument();
    });
  });

  // The mobile meta footer now stacks under the title inside the shared content column
  // (rowContentColClass) rather than via a per-row inline paddingLeft, so the badges align
  // under the title structurally. That layout is locked by the task-row.styles unit test
  // (the content column + footer classes) and the mobile-cards Storybook snapshot; there's no
  // computed indent left to assert here.

  // ---------------------------------------------------------------------------
  // The gate: Send to Code module / Convert to Code Story menu entries
  // ---------------------------------------------------------------------------

  describe('the gate menu entries', () => {
    it('offers "Send to Code module…" on a code-classified item', async () => {
      const user = userEvent.setup();
      renderTasks([CODE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');

      expect(screen.getByRole('menuitem', { name: /send to code module/i })).toBeInTheDocument();
      // A code item is NOT a task/unclassified, so it does not offer Convert.
      expect(
        screen.queryByRole('menuitem', { name: /convert to code story/i }),
      ).not.toBeInTheDocument();
    });

    it('offers "Convert to Code Story…" on a task (not Send to Code module)', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');

      expect(screen.getByRole('menuitem', { name: /convert to code story/i })).toBeInTheDocument();
      expect(
        screen.queryByRole('menuitem', { name: /send to code module/i }),
      ).not.toBeInTheDocument();
    });

    it('offers "Convert to Code Story…" on an unclassified item', async () => {
      const user = userEvent.setup();
      renderTasks([UNCLASSIFIED_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');

      expect(screen.getByRole('menuitem', { name: /convert to code story/i })).toBeInTheDocument();
    });

    it('opens the gate dialog from "Send to Code module…"', async () => {
      const user = userEvent.setup();
      renderTasks([CODE_ITEM]);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await activateMenuItem(user, /send to code module/i);

      // The gate dialog opens, naming the item it will admit.
      const dialog = await screen.findByRole('dialog', { name: /send to code module/i });
      expect(within(dialog).getByText(/write tests/i)).toBeInTheDocument();
    });

    it('removes the item and toasts the ref when the gate completes', async () => {
      // One project + epic seeded into the CodeProvider so the gate can be confirmed end to end.
      const project: Project = {
        id: 'p1',
        name: 'Alfred',
        key: 'ALF',
        repo_owner: 'ac3charland',
        repo_name: 'alfred',
        github_url: null,
        ref_seq: 0,
        created_at: '2025-01-01T00:00:00Z',
      };
      const epic: Epic = {
        id: 'e1',
        project_id: 'p1',
        name: 'Firewall',
        notes: null,
        ref_number: 1,
        ref: 'ALF-1',
        archived_at: null,
        created_at: '2025-01-01T00:00:00Z',
      };
      mockEnterCodeModule.mockResolvedValue({
        item_id: 'item-1',
        project_id: 'p1',
        epic_id: 'e1',
        ref_number: 42,
        ref: 'ALF-42',
        factory_state: 'needs_refinement',
        lane: 'human',
        spec_path: null,
        spec_sha: null,
        spec_markdown: null,
        refinement_pr_url: null,
        implementation_pr_url: null,
        blocked_reason: null,
        created_at: '2025-01-02T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
        priority: 1,
      });

      const user = userEvent.setup();
      renderTasks([CODE_ITEM], { projects: [project], epics: [epic] });

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await activateMenuItem(user, /send to code module/i);

      const dialog = await screen.findByRole('dialog', { name: /send to code module/i });
      await user.click(await within(dialog).findByRole('option', { name: /alfred/i }));
      await user.click(await within(dialog).findByRole('option', { name: /firewall/i }));
      await user.click(within(dialog).getByRole('button', { name: /send to code module/i }));

      // The toast announces the new ref and deep-links to the story's board modal…
      expect(await screen.findByRole('link', { name: 'Created ALF-42' })).toHaveAttribute(
        'href',
        '/code/p1?story=ALF-42',
      );
      // …and the gated item has left the inbox view (removed from the store).
      await waitFor(() => {
        expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
      });
    });
  });
});

// 2026-06-01 is a Monday — the weekly anchor for these recurrence fixtures.
const RECURRING_ITEM: Item = {
  ...BASE_ITEM,
  due_date: '2026-06-01',
  occurrence_index: 1,
  recurrence: { freq: 'weekly', interval: 1, byweekday: [1], end: { type: 'never' } },
};

describe('TaskRow — recurrence', () => {
  it('shows a recurrence chip on a top-level recurring task row', () => {
    renderTasks([RECURRING_ITEM]);
    expect(screen.getByRole('button', { name: 'Repeats: Weekly on Mon' })).toBeInTheDocument();
  });

  it('does not show a recurrence chip on a non-recurring task', () => {
    renderTasks([BASE_ITEM]);
    expect(screen.queryByRole('button', { name: /repeats:/i })).not.toBeInTheDocument();
  });
});

/**
 * The capture entrance (ALF-20): a freshly-added row animates in — its height expands from 0,
 * pushing the rows below it down, while its content fades and slides in from above. The trigger
 * is the optimistic temp id every just-inserted row carries until the server reconcile swaps it
 * for the real id, so server-seeded rows (a page load, a view switch) never animate.
 */
/**
 * A row's OWN entrance wrapper (a direct child of its <li>), or null when the row is not
 * animating in. Scoped to `:scope >` so a parent doesn't match a nested subtask's wrapper.
 */
function entranceWrapperFor(title: string): HTMLElement | null {
  const li = screen.getByText(title).closest('li');
  if (!li) throw new Error('task row <li> not found');
  return li.querySelector<HTMLElement>(':scope > [data-testid="animated-height-enter"]');
}

describe('TaskRow entrance animation', () => {
  const TEMP_ITEM: Item = {
    ...BASE_ITEM,
    id: 'temp-abc',
    title: 'Just captured',
    item_type: 'unclassified',
  };

  it('wraps a freshly-added (temp-id) row in the height-expand entrance', () => {
    renderTasks([TEMP_ITEM]);
    const wrapper = entranceWrapperFor('Just captured');
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass('animate-expand-y', 'motion-reduce:animate-none');
  });

  it('does not animate a server-seeded (real-id) row', () => {
    renderTasks([BASE_ITEM]);
    expect(entranceWrapperFor('Write tests')).toBeNull();
  });

  it('animates a freshly-added subtask but not its already-present siblings', () => {
    const parent: Item = { ...BASE_ITEM, id: 'parent-1', title: 'Parent' };
    const existingChild: Item = {
      ...CHILD_ITEM,
      id: 'child-real',
      title: 'Existing subtask',
      parent_id: 'parent-1',
    };
    const newChild: Item = {
      ...CHILD_ITEM,
      id: 'temp-child',
      title: 'New subtask',
      parent_id: 'parent-1',
      created_at: '2025-01-01T12:00:00Z',
    };
    renderTasks([parent, existingChild, newChild]);

    expect(entranceWrapperFor('New subtask')).not.toBeNull();
    expect(entranceWrapperFor('Existing subtask')).toBeNull();
    expect(entranceWrapperFor('Parent')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ALF-67 — row badges, the ⋯ menu's "Open details", and the auto-saving detail panel
// ---------------------------------------------------------------------------

/**
 * Open the root row's ⋯ menu and choose "Open details", revealing the inline detail panel.
 * Uses the FIRST "More actions" button so an expanded subtree (whose child rows carry their own
 * menu) doesn't make the query ambiguous.
 */
async function openDetails(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const [moreActions] = screen.getAllByRole('button', { name: /more actions/i });
  if (!moreActions) throw new Error('no "More actions" button found');
  await user.click(moreActions);
  await screen.findByRole('menu');
  await activateMenuItem(user, /open details/i);
  return screen.getByTestId('task-detail-panel');
}

describe('TaskRow — row badges (ALF-67)', () => {
  it('renders the priority symbol-only on the row (no visible label, aria-label intact)', () => {
    renderTasks([{ ...BASE_ITEM, priority: 'high' }]);
    const badge = screen.getByRole('button', { name: 'Priority: High' });
    // Symbol-only: the level word is not rendered as visible text on the row.
    expect(badge).not.toHaveTextContent('High');
  });

  it('shows the subtask count as completed/total of the direct subtasks', () => {
    const done: Item = { ...CHILD_ITEM, id: 'c1', status: 'completed' };
    const open: Item = { ...CHILD_ITEM, id: 'c2', title: 'Open one' };
    renderTasks([BASE_ITEM, done, open]);
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('shows no subtask-count badge when the task has no subtasks', () => {
    renderTasks([BASE_ITEM]);
    expect(screen.queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument();
  });

  it('keeps the subtask-count badge while the subtree is expanded', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM, CHILD_ITEM]);
    expect(screen.getByText('0/1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
    expect(screen.getByText('0/1')).toBeInTheDocument();
  });

  it('shows a one-line notes preview beneath the title when notes exist', () => {
    renderTasks([{ ...BASE_ITEM, notes: 'Compare three vendors first' }]);
    expect(screen.getByText('Compare three vendors first')).toBeInTheDocument();
  });

  it('shows no notes preview when the task has no notes', () => {
    renderTasks([BASE_ITEM]);
    expect(screen.queryByText(/vendors/i)).not.toBeInTheDocument();
  });

  it('does not open the detail panel when the due-date badge is clicked (display-only)', async () => {
    const user = userEvent.setup();
    renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);
    await user.click(screen.getByRole('button', { name: /due date:/i }));
    expect(screen.queryByTestId('task-detail-panel')).not.toBeInTheDocument();
  });
});

describe('TaskRow — ⋯ menu (ALF-67)', () => {
  it('leads a task menu with "Open details", then the mobile-only "Add subtask"', async () => {
    // On a task row "Open details" leads (the primary action), with the `md:hidden` "Add
    // subtask" affordance directly beneath it (ALF-118). In jsdom the `md:hidden` item is still
    // present (media queries don't apply), so it's index 1 right after "Open details" at index 0.
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    await user.click(screen.getByRole('button', { name: /more actions/i }));
    await screen.findByRole('menu');
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveAccessibleName(/open details/i);
    expect(items[1]).toHaveAccessibleName(/add subtask/i);
  });

  it('leads a non-task menu with "Open details" (no Add subtask item)', async () => {
    // A code/unclassified row nests no subtasks, so it has no "Add subtask" item — "Open
    // details" is the first entry, exactly as before ALF-118.
    const user = userEvent.setup();
    renderTasks([{ ...BASE_ITEM, item_type: 'code' }]);
    await user.click(screen.getByRole('button', { name: /more actions/i }));
    await screen.findByRole('menu');
    expect(screen.getAllByRole('menuitem')[0]).toHaveAccessibleName(/open details/i);
  });

  it('no longer offers Set due date / Set priority / Add notes', async () => {
    const user = userEvent.setup();
    renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31', notes: 'hi', priority: 'high' }]);
    await user.click(screen.getByRole('button', { name: /more actions/i }));
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: /due date/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /priority/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /notes/i })).not.toBeInTheDocument();
  });

  it('does not offer a Duplicate entry (deferred)', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    await user.click(screen.getByRole('button', { name: /more actions/i }));
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: /duplicate/i })).not.toBeInTheDocument();
  });

  it('still offers Move to… and Delete', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM], { folders: [FOLDER] });
    await user.click(screen.getByRole('button', { name: /more actions/i }));
    await screen.findByRole('menu');
    expect(screen.getByRole('menuitem', { name: /move to/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^delete$/i })).toBeInTheDocument();
  });
});

describe('TaskRow — detail panel (ALF-67)', () => {
  it('opens the inline detail panel from "Open details"', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    expect(screen.queryByTestId('task-detail-panel')).not.toBeInTheDocument();
    await openDetails(user);
    expect(screen.getByTestId('task-detail-panel')).toBeInTheDocument();
  });

  it('toggles the detail panel closed when "Open details" is chosen again', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    await openDetails(user);
    await user.click(screen.getByRole('button', { name: /more actions/i }));
    await screen.findByRole('menu');
    await activateMenuItem(user, /open details/i);
    expect(screen.queryByTestId('task-detail-panel')).not.toBeInTheDocument();
  });

  it('opening the detail panel does NOT expand the subtask tree', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM, CHILD_ITEM]);
    await openDetails(user);
    expect(screen.getByTestId('task-detail-panel')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Subtasks' })).not.toBeInTheDocument();
  });

  it('shows the Due, Repeat and Priority chips plus a Notes editor for a top-level task', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    await openDetails(user);
    expect(screen.getByRole('button', { name: 'Due date' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repeat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Priority' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument();
  });

  it('has no Save / Cancel / Close controls (edits auto-save)', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    const panel = await openDetails(user);
    expect(within(panel).queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /^close$/i })).not.toBeInTheDocument();
  });

  it('auto-saves a priority pick and closes the popover', async () => {
    mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, priority: 'high' });
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    await openDetails(user);

    await user.click(screen.getByRole('button', { name: 'Priority' }));
    await user.click(await screen.findByRole('menuitem', { name: 'High' }));

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { priority: 'high' });
    });
  });

  it('auto-saves a repeat preset (stamping today as the anchor when there is no due date)', async () => {
    mockUpdateItem.mockResolvedValue(BASE_ITEM);
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    await openDetails(user);

    await user.click(screen.getByRole('button', { name: 'Repeat' }));
    await user.click(await screen.findByRole('button', { name: 'Daily' }));

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalled();
    });
    const patch = mockUpdateItem.mock.calls.find((call) => call[0] === 'item-1')?.[1];
    // A daily rule is saved, and today is stamped as the anchor since the task had no due date.
    expect(patch).toMatchObject({ recurrence: { freq: 'daily' }, due_date: todayISODate() });
  });

  it('auto-saves a due date picked from the calendar (Today)', async () => {
    mockUpdateItem.mockResolvedValue(BASE_ITEM);
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    await openDetails(user);

    await user.click(screen.getByRole('button', { name: 'Due date' }));
    await user.click(await screen.findByRole('button', { name: /^today$/i }));

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { due_date: todayISODate() });
    });
  });

  it('clears the due date (and its recurrence) from the calendar footer', async () => {
    mockUpdateItem.mockResolvedValue(BASE_ITEM);
    const user = userEvent.setup();
    renderTasks([
      {
        ...BASE_ITEM,
        due_date: '2099-12-31',
        recurrence: { freq: 'daily', interval: 1, end: { type: 'never' } },
      },
    ]);
    await openDetails(user);

    await user.click(screen.getByRole('button', { name: 'Due date' }));
    await user.click(await screen.findByRole('button', { name: /^clear$/i }));

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { due_date: null, recurrence: null });
    });
  });

  it('auto-saves notes on blur', async () => {
    mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, notes: 'Buy milk' });
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    await openDetails(user);

    const notes = screen.getByRole('textbox', { name: 'Notes' });
    await user.type(notes, 'Buy milk');
    await user.tab();

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { notes: 'Buy milk' });
    });
  });

  it('does not save notes that are unchanged', async () => {
    const user = userEvent.setup();
    renderTasks([{ ...BASE_ITEM, notes: 'Existing' }]);
    await openDetails(user);

    const notes = screen.getByRole('textbox', { name: 'Notes' });
    expect(notes).toHaveValue('Existing');
    await user.click(notes);
    await user.tab();

    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('hides the Due, Repeat and Priority chips on a non-task row but keeps Notes', async () => {
    const user = userEvent.setup();
    renderTasks([{ ...BASE_ITEM, item_type: 'unclassified' }]);
    await openDetails(user);
    expect(screen.queryByRole('button', { name: 'Due date' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Repeat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Priority' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument();
  });

  it('keeps the detail panel and the subtask tree independent', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM, CHILD_ITEM]);
    // Expand subtasks, then open the detail: both are visible at once.
    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
    await openDetails(user);
    expect(screen.getByTestId('task-detail-panel')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Subtasks' })).toBeInTheDocument();
  });
});

describe('TaskRow — dismissing the detail panel (ALF-78)', () => {
  it('closes the detail panel when Escape is pressed', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    await openDetails(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('task-detail-panel')).not.toBeInTheDocument();
  });

  it('closes the detail panel on a pointer press outside the row', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    await openDetails(user);
    await user.click(document.body);
    expect(screen.queryByTestId('task-detail-panel')).not.toBeInTheDocument();
  });

  it('keeps the detail panel open when clicking inside it', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    const panel = await openDetails(user);
    await user.click(within(panel).getByRole('textbox', { name: 'Notes' }));
    expect(screen.getByTestId('task-detail-panel')).toBeInTheDocument();
  });

  it('keeps the detail panel open when clicking elsewhere on the same row', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    await openDetails(user);
    // The title lives in the row body, outside the panel but inside the row — not a dismiss.
    await user.click(screen.getByText('Write tests'));
    expect(screen.getByTestId('task-detail-panel')).toBeInTheDocument();
  });

  it('lets an open picker popover consume Escape without closing the panel', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    await openDetails(user);

    await user.click(screen.getByRole('button', { name: 'Priority' }));
    await screen.findByRole('menuitem', { name: 'High' });
    // First Escape closes the picker menu; the panel stays open.
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('task-detail-panel')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'High' })).not.toBeInTheDocument();
    });
    // A second Escape (no popover open) now closes the panel.
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('task-detail-panel')).not.toBeInTheDocument();
  });

  it('does not close the panel when a picker option is clicked', async () => {
    mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, priority: 'high' });
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);
    await openDetails(user);

    await user.click(screen.getByRole('button', { name: 'Priority' }));
    await user.click(await screen.findByRole('menuitem', { name: 'High' }));

    // Selecting auto-saves and closes the menu, but the detail panel remains open.
    expect(screen.getByTestId('task-detail-panel')).toBeInTheDocument();
  });
});
