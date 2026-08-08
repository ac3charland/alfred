import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { pinClock } from '@/lib/pin-clock';
import type { Item } from '@/lib/types';

import {
  type TaskScope,
  TasksProvider,
  tasksReducer,
  useFolderBadgeCounts,
  useScopedTasks,
  useTaskActions,
  useTasks,
} from './tasks-store';

jest.mock('@/lib/api-client');
const mockCreateItem = jest.mocked(apiClient.createItem);
const mockCompleteTask = jest.mocked(apiClient.completeTask);
const mockUpdateItem = jest.mocked(apiClient.updateItem);
const mockDeleteItem = jest.mocked(apiClient.deleteItem);
const mockMoveToInbox = jest.mocked(apiClient.moveToInbox);

// Capture showToast so the error-toast tests can assert the message a failed write surfaces
// (ALF-33). Mocking useToastActions short-circuits the context, so the provider needs no
// ToastProvider wrapper — consistent with code-store.test.tsx.
const mockShowToast = jest.fn();
jest.mock('@/lib/stores/toast-store', () => ({
  ...jest.requireActual<typeof import('@/lib/stores/toast-store')>('@/lib/stores/toast-store'),
  useToastActions: () => ({ showToast: mockShowToast, dismissToast: jest.fn() }),
}));

pinClock('2026-07-28T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Fixtures (flat items)
// ---------------------------------------------------------------------------

const BASE: Item = {
  id: 'item-1',
  title: 'Task',
  notes: null,
  source_url: null,
  item_type: 'task',
  created_at: '2025-01-01T10:00:00Z',
  raw_capture: null,
  due_date: null,
  status: 'active',
  completed_at: null,
  folder_id: null,
  dispatched_at: null,
  parent_id: null,
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
  intended_epic_id: null,
  sort_order: 0,
};

/** Fixed residency stamp for a seeded FILED item — fixtures pin the clock, never read it. */
const DISPATCHED_AT = '2025-01-01T11:00:00Z';

function item(overrides: Partial<Item>): Item {
  const row = { ...BASE, ...overrides };
  // A fixture with a folder is a filed item, so it defaults to dispatched — every existing seed
  // that says `folder_id: 'f1'` keeps meaning "filed in f1". State `dispatched_at: null`
  // explicitly to seed the one state this story creates: foldered, but still in the Inbox.
  if (overrides.dispatched_at === undefined && row.folder_id !== null) {
    return { ...row, dispatched_at: DISPATCHED_AT };
  }
  return row;
}

/** Hold the create API promise open, so an assertion sees the OPTIMISTIC row, not the reconciled one. */
function pendingCreate() {
  mockCreateItem.mockReturnValue(new Promise<Item>(() => {}));
}

function makeWrapper(initialTasks: Item[]) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <TasksProvider initialTasks={initialTasks}>{children}</TasksProvider>;
  };
}

function useTasksTest() {
  return { tasks: useTasks(), actions: useTaskActions() };
}

// ---------------------------------------------------------------------------
// Reducer (pure)
// ---------------------------------------------------------------------------

describe('tasksReducer', () => {
  const A = item({ id: 'a' });
  const B = item({ id: 'b' });

  it('insert appends an item', () => {
    expect(tasksReducer([A], { type: 'insert', item: B })).toStrictEqual([A, B]);
  });

  it('replace swaps a single item by id and is a no-op for an absent id', () => {
    const renamed = { ...A, title: 'Renamed' };
    expect(tasksReducer([A], { type: 'replace', id: 'a', item: renamed })).toStrictEqual([renamed]);
    expect(tasksReducer([A], { type: 'replace', id: 'gone', item: renamed })).toStrictEqual([A]);
  });

  it('patch merges into every id in the set (race rule: absent ids skipped)', () => {
    const result = tasksReducer([A, B], { type: 'patch', ids: ['a', 'b'], patch: { notes: 'x' } });
    expect(result.map((i) => i.notes)).toStrictEqual(['x', 'x']);
    expect(
      tasksReducer([A], { type: 'patch', ids: ['gone'], patch: { notes: 'x' } }),
    ).toStrictEqual([A]);
  });

  it('upsert replaces present items and appends missing ones', () => {
    const A2 = { ...A, title: 'A2' };
    const C = item({ id: 'c' });
    expect(tasksReducer([A], { type: 'upsert', items: [A2, C] })).toStrictEqual([A2, C]);
  });

  it('remove drops every id in the set', () => {
    expect(tasksReducer([A, B], { type: 'remove', ids: ['a'] })).toStrictEqual([B]);
  });

  it('unknown action type throws via assertNever', () => {
    expect(() =>
      tasksReducer([A], { type: 'unknown' } as unknown as Parameters<typeof tasksReducer>[1]),
    ).toThrow('Unhandled task action');
  });
});

// ---------------------------------------------------------------------------
// addTask
// ---------------------------------------------------------------------------

describe('addTask', () => {
  it('inserts an optimistic temp item, then reconciles to the server row', async () => {
    const saved = item({ id: 'server-1', title: 'Buy milk' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'Buy milk' });
    });

    expect(result.current.tasks.map((t) => t.id)).toStrictEqual(['server-1']);
  });

  it('inserts a temp item synchronously before the request resolves', () => {
    mockCreateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    act(() => {
      void result.current.actions.addTask({ text: 'Buy milk' });
    });

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]?.id.startsWith('temp-')).toBe(true);
  });

  it('gives a new subtask an optimistic sort_order below its current siblings (ALF-117)', () => {
    // A parent with two existing subtasks (sort_order 10, 30). A third appends at the bottom:
    // max(sibling sort_order) + 1 = 31, so buildTree keeps it last until the server reconciles.
    mockCreateItem.mockReturnValue(new Promise<Item>(() => {}));
    const parent = item({ id: 'p1' });
    const a = item({ id: 'a', parent_id: 'p1', sort_order: 10 });
    const b = item({ id: 'b', parent_id: 'p1', sort_order: 30 });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, a, b]) });

    act(() => {
      void result.current.actions.addTask({ text: 'third', parentId: 'p1' });
    });

    const fresh = result.current.tasks.find((t) => t.id.startsWith('temp-'));
    expect(fresh?.sort_order).toBe(31);
  });

  it('rolls back the optimistic item when creation fails', async () => {
    mockCreateItem.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'oops' }).catch(() => {});
    });

    expect(result.current.tasks).toStrictEqual([]);
  });

  // The DB fills residency at insert (inherit the parent's, else a folder means dispatched), so
  // the optimistic row has to predict the same value — otherwise the new row flashes into the
  // wrong view for one render before the server row reconciles it back.
  describe('predicts the residency the saved row will get', () => {
    it('leaves a plain capture in the Inbox', () => {
      pendingCreate();
      const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

      act(() => void result.current.actions.addTask({ text: 'A thought' }));

      expect(result.current.tasks[0]?.dispatched_at).toBeNull();
    });

    it('dispatches a capture made inside a folder', () => {
      pendingCreate();
      const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

      act(() => void result.current.actions.addTask({ text: 'Filed', folderId: 'folder-1' }));

      expect(result.current.tasks[0]?.dispatched_at).not.toBeNull();
    });

    it('has a subtask adopt its parent’s residency, not its own folder', () => {
      pendingCreate();
      // A parent that carries a folder but is still in the Inbox: its new subtask belongs in the
      // Inbox too, even though the "add subtask" field passes the parent's folder along.
      const parent = item({ id: 'p1', folder_id: 'folder-1', dispatched_at: null });
      const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent]) });

      act(
        () =>
          void result.current.actions.addTask({
            text: 'Subtask',
            parentId: 'p1',
            folderId: 'folder-1',
          }),
      );

      expect(result.current.tasks.find((t) => t.title === 'Subtask')?.dispatched_at).toBeNull();
    });
  });

  it('includes parent_id in the API call when parentId is provided', async () => {
    const saved = item({ id: 'server-1', parent_id: 'parent-1' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'Subtask', parentId: 'parent-1' });
    });

    expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ parent_id: 'parent-1' }));
  });

  it('does NOT include parent_id in the API call when parentId is null (treated as absent)', async () => {
    // `input.parentId ?? undefined` must use `??` not `&&`:
    // null ?? undefined = undefined (so parent_id is omitted)
    // null && undefined = null (which would cause parent_id: null to be spread if condition passes)
    const saved = item({ id: 'server-1' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'Root task', parentId: null });
    });

    // parent_id must not be included at all in the payload
    const callArg = mockCreateItem.mock.calls[0]?.[0];
    expect(callArg).not.toHaveProperty('parent_id');
  });

  it('does NOT include parent_id in the API call when parentId is undefined', async () => {
    const saved = item({ id: 'server-1' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'Root task' });
    });

    const callArg = mockCreateItem.mock.calls[0]?.[0];
    expect(callArg).not.toHaveProperty('parent_id');
  });

  it('uses item_type task when parentId is provided (subtask must be a task)', async () => {
    const saved = item({ id: 'server-1', parent_id: 'parent-1', item_type: 'task' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'Subtask', parentId: 'parent-1' });
    });

    expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ item_type: 'task' }));
  });

  it('uses item_type unclassified when no parentId is provided (top-level capture)', async () => {
    const saved = item({ id: 'server-1' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'Root task' });
    });

    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ item_type: 'unclassified' }),
    );
  });

  it('creates a parentless capture carrying a folder as a task (filing classifies)', async () => {
    // Folders hold tasks: an unclassified row in a folder has no completion checkbox, so a
    // capture made from a folder view could never be ticked off. Filing classifies, exactly
    // as moveTask does when an unclassified item is dropped into a folder.
    const saved = item({ id: 'server-1', folder_id: 'folder-1', item_type: 'task' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'Ship the deck', folderId: 'folder-1' });
    });

    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ item_type: 'task', folder_id: 'folder-1' }),
    );
  });

  it('shows the folder capture as a task on the optimistic row, before the server responds', () => {
    pendingCreate();
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    act(() => {
      void result.current.actions.addTask({ text: 'Ship the deck', folderId: 'folder-1' });
    });

    expect(result.current.tasks[0]?.item_type).toBe('task');
  });

  it('leaves an explicit itemType winning over the folder rule', async () => {
    const saved = item({ id: 'server-1', item_type: 'code' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({
        text: 'ALF: add dark mode',
        itemType: 'code',
        folderId: 'folder-1',
      });
    });

    expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ item_type: 'code' }));
  });

  it('leaves a subtask under a code parent unaffected by the folder rule', async () => {
    // The parent branch is evaluated first, so a folder riding along on a subtask capture
    // (the add-subtask box passes its parent's folder) never overrides the inherited family.
    const codeParent = item({ id: 'code-parent', item_type: 'code', folder_id: 'folder-1' });
    const saved = item({ id: 'server-1', parent_id: 'code-parent', item_type: 'code' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([codeParent]) });

    await act(async () => {
      await result.current.actions.addTask({
        text: 'A story',
        parentId: 'code-parent',
        folderId: 'folder-1',
      });
    });

    expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ item_type: 'code' }));
  });

  it('creates a code child when the parent is a code row (a child inherits its family)', async () => {
    const codeParent = item({ id: 'code-parent', item_type: 'code' });
    const saved = item({ id: 'server-1', parent_id: 'code-parent', item_type: 'code' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([codeParent]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'A story', parentId: 'code-parent' });
    });

    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ item_type: 'code', parent_id: 'code-parent' }),
    );
  });

  it('creates a task child when the parent is a task row', async () => {
    const taskParent = item({ id: 'task-parent', item_type: 'task' });
    const saved = item({ id: 'server-1', parent_id: 'task-parent' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([taskParent]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'A subtask', parentId: 'task-parent' });
    });

    expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({ item_type: 'task' }));
  });

  it('optimistic subtask row has item_type task before the server responds', () => {
    mockCreateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    act(() => {
      void result.current.actions.addTask({ text: 'Subtask', parentId: 'parent-1' });
    });

    expect(result.current.tasks[0]?.item_type).toBe('task');
  });

  it('threads a matched prefix (title, code type, intended project) into the API call (ALF-62)', async () => {
    const saved = item({ id: 'server-1', item_type: 'code' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({
        text: 'ALF: add dark mode',
        itemType: 'code',
        title: 'Add dark mode',
        intendedProjectId: 'p-alf',
      });
    });

    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'ALF: add dark mode',
        raw_capture: 'ALF: add dark mode',
        title: 'Add dark mode',
        item_type: 'code',
        intended_project_id: 'p-alf',
      }),
    );
  });

  it('reflects the matched title, code type, and intended project on the optimistic row (ALF-62)', () => {
    mockCreateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    act(() => {
      void result.current.actions.addTask({
        text: 'ALF: add dark mode',
        itemType: 'code',
        title: 'Add dark mode',
        intendedProjectId: 'p-alf',
      });
    });

    const optimistic = result.current.tasks[0];
    expect(optimistic?.title).toBe('Add dark mode');
    expect(optimistic?.item_type).toBe('code');
    expect(optimistic?.intended_project_id).toBe('p-alf');
    expect(optimistic?.raw_capture).toBe('ALF: add dark mode');
  });

  it('does NOT attach an intended project to a subtask capture (parent forces a task) (ALF-62)', async () => {
    const saved = item({ id: 'server-1', parent_id: 'parent-1', item_type: 'task' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({
        text: 'Subtask',
        parentId: 'parent-1',
        intendedProjectId: 'p-alf',
      });
    });

    const callArg = mockCreateItem.mock.calls[0]?.[0];
    expect(callArg).not.toHaveProperty('intended_project_id');
    expect(callArg?.item_type).toBe('task');
  });
});

// ---------------------------------------------------------------------------
// completeTask (cascades to the subtree)
// ---------------------------------------------------------------------------

describe('completeTask', () => {
  const parent = item({ id: 'item-1' });
  const child = item({ id: 'c-1', parent_id: 'item-1' });

  it('marks the task and its subtree completed, then reconciles', async () => {
    mockCompleteTask.mockResolvedValue({
      completed: [
        { ...parent, status: 'completed' },
        { ...child, status: 'completed' },
      ],
      spawned: null,
    });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    await act(async () => {
      await result.current.actions.completeTask('item-1');
    });

    expect(result.current.tasks.every((t) => t.status === 'completed')).toBe(true);
    expect(mockCompleteTask).toHaveBeenCalledWith('item-1');
  });

  it('marks the subtree completed optimistically before the request resolves', () => {
    mockCompleteTask.mockReturnValue(new Promise<apiClient.CompleteTaskResult>(() => {}));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    act(() => {
      void result.current.actions.completeTask('item-1');
    });

    expect(result.current.tasks.every((t) => t.status === 'completed')).toBe(true);
  });

  it('rolls the subtree back to active when completion fails', async () => {
    mockCompleteTask.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    await act(async () => {
      await result.current.actions.completeTask('item-1').catch(() => {});
    });

    expect(result.current.tasks.every((t) => t.status === 'active')).toBe(true);
  });

  it('is a no-op and does not call the API when the id is not in the store', async () => {
    // Guard: if (affected.length === 0) return — must not call API for unknown ids
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent]) });

    await act(async () => {
      await result.current.actions.completeTask('does-not-exist');
    });

    expect(mockCompleteTask).not.toHaveBeenCalled();
    // Store unchanged
    expect(result.current.tasks[0]?.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// completeTask — recurrence (spawn the next occurrence)
// ---------------------------------------------------------------------------

describe('completeTask with recurrence', () => {
  // A daily recurring top-level task due 2026-06-01 (a real YYYY-MM-DD so the engine advances).
  const recurring = item({
    id: 'r-1',
    due_date: '2026-06-01',
    occurrence_index: 1,
    recurrence: { freq: 'daily', interval: 1, end: { type: 'never' } },
  });

  it('optimistically inserts the next occurrence before the request resolves', () => {
    mockCompleteTask.mockReturnValue(new Promise<apiClient.CompleteTaskResult>(() => {}));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([recurring]) });

    act(() => {
      void result.current.actions.completeTask('r-1');
    });

    const active = result.current.tasks.filter((t) => t.status === 'active');
    expect(active).toHaveLength(1);
    expect(active[0]?.due_date).toBe('2026-06-02');
    expect(active[0]?.occurrence_index).toBe(2);
    // The completed original is kept (Completed view history).
    expect(result.current.tasks.find((t) => t.id === 'r-1')?.status).toBe('completed');
  });

  it('replaces the optimistic occurrence with the authoritative server row', async () => {
    const serverSpawn = item({
      id: 'r-2',
      due_date: '2026-06-02',
      occurrence_index: 2,
      recurrence_series_id: 'series-xyz',
      recurrence: { freq: 'daily', interval: 1, end: { type: 'never' } },
    });
    mockCompleteTask.mockResolvedValue({
      completed: [{ ...recurring, status: 'completed' }],
      spawned: serverSpawn,
    });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([recurring]) });

    await act(async () => {
      await result.current.actions.completeTask('r-1');
    });

    // The temp optimistic row is gone; the server row (with its series id) is present.
    const active = result.current.tasks.filter((t) => t.status === 'active');
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe('r-2');
    expect(active[0]?.recurrence_series_id).toBe('series-xyz');
  });

  it('drops the optimistic occurrence when the server reports no spawn (series ended)', async () => {
    // The store predicts a spawn (end: never), but the server authoritatively returns none.
    mockCompleteTask.mockResolvedValue({
      completed: [{ ...recurring, status: 'completed' }],
      spawned: null,
    });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([recurring]) });

    await act(async () => {
      await result.current.actions.completeTask('r-1');
    });

    expect(result.current.tasks.filter((t) => t.status === 'active')).toHaveLength(0);
    expect(result.current.tasks.find((t) => t.id === 'r-1')?.status).toBe('completed');
  });

  it('rolls back the completion AND the optimistic occurrence on failure', async () => {
    mockCompleteTask.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([recurring]) });

    await act(async () => {
      await result.current.actions.completeTask('r-1').catch(() => {});
    });

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]?.id).toBe('r-1');
    expect(result.current.tasks[0]?.status).toBe('active');
  });

  it('does not spawn for a non-recurring task', () => {
    mockCompleteTask.mockReturnValue(new Promise<apiClient.CompleteTaskResult>(() => {}));
    const plain = item({ id: 'p-1', due_date: '2026-06-01' });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([plain]) });

    act(() => {
      void result.current.actions.completeTask('p-1');
    });

    // Only the (now-completed) original — no new active row.
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]?.status).toBe('completed');
  });

  it('does not spawn when the local end condition is already reached', () => {
    mockCompleteTask.mockReturnValue(new Promise<apiClient.CompleteTaskResult>(() => {}));
    const ended = item({
      id: 'e-1',
      due_date: '2026-06-01',
      occurrence_index: 1,
      recurrence: { freq: 'daily', interval: 1, end: { type: 'after', count: 1 } },
    });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([ended]) });

    act(() => {
      void result.current.actions.completeTask('e-1');
    });

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]?.status).toBe('completed');
  });
});

describe('uncompleteTask', () => {
  const completed = item({
    id: 'item-1',
    status: 'completed',
    completed_at: '2025-01-05T00:00:00Z',
  });
  const completed2 = item({
    id: 'item-2',
    status: 'completed',
    completed_at: '2025-01-06T00:00:00Z',
  });

  it('reactivates a completed task and reconciles', async () => {
    mockUpdateItem.mockResolvedValue({ ...completed, status: 'active', completed_at: null });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([completed]) });

    await act(async () => {
      await result.current.actions.uncompleteTask('item-1');
    });

    expect(result.current.tasks[0]?.status).toBe('active');
    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { status: 'active' });
  });

  it('optimistically sets status to "active" (not an empty string or other value)', () => {
    // Ensures `status: 'active'` in the patch is not mutated to `status: ''`
    mockUpdateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([completed]) });

    act(() => {
      void result.current.actions.uncompleteTask('item-1');
    });

    expect(result.current.tasks[0]?.status).toBe('active');
  });

  it('reconciles the store with the server row after uncomplete (not an empty upsert)', async () => {
    // `dispatch({ type: 'upsert', items: [saved] })` must include [saved], not []
    const serverRow = item({
      id: 'item-1',
      status: 'active',
      completed_at: null,
      title: 'from server',
    });
    mockUpdateItem.mockResolvedValue(serverRow);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([completed]) });

    await act(async () => {
      await result.current.actions.uncompleteTask('item-1');
    });

    // Server title must be reflected (proves the upsert included the saved item)
    expect(result.current.tasks[0]?.title).toBe('from server');
  });

  it('reactivates the correct task when multiple completed tasks exist', async () => {
    // find predicate must use item.id === id (not find(() => true) which returns first)
    const savedItem2 = item({ id: 'item-2', status: 'active', completed_at: null });
    mockUpdateItem.mockResolvedValue(savedItem2);
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([completed, completed2]),
    });

    await act(async () => {
      await result.current.actions.uncompleteTask('item-2');
    });

    // item-1 must remain completed; item-2 must be active
    expect(result.current.tasks[0]?.status).toBe('completed');
    expect(result.current.tasks[1]?.status).toBe('active');
  });

  it('rolls back the correct item (not the first item) when uncomplete of second item fails', async () => {
    // find predicate: if () => true, rollback would restore item-1's original data to item-2
    // Only catches if the two items have distinguishable completed_at values
    const completed1 = item({
      id: 'item-1',
      status: 'completed',
      title: 'First',
      completed_at: '2025-01-01T00:00:00Z',
    });
    const completed2b = item({
      id: 'item-2',
      status: 'completed',
      title: 'Second',
      completed_at: '2025-01-02T00:00:00Z',
    });
    mockUpdateItem.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([completed1, completed2b]),
    });

    await act(async () => {
      await result.current.actions.uncompleteTask('item-2').catch(() => {});
    });

    // item-2 must be rolled back to its OWN original data, not item-1's data
    expect(result.current.tasks[1]?.title).toBe('Second');
    expect(result.current.tasks[1]?.status).toBe('completed');
  });

  it('is a no-op and does not call the API when the id is not in the store', async () => {
    // Guard: if (affected.length === 0) return
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([completed]) });

    await act(async () => {
      await result.current.actions.uncompleteTask('does-not-exist');
    });

    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(result.current.tasks[0]?.status).toBe('completed');
  });

  it('reactivates the completed ancestor chain when uncompleting a nested completed task', async () => {
    // P(completed) → C(completed). Unchecking C must also reactivate P: a completed parent
    // cannot keep an active child.
    const parent = item({ id: 'p', status: 'completed', completed_at: '2025-01-05T00:00:00Z' });
    const child = item({
      id: 'c',
      parent_id: 'p',
      status: 'completed',
      completed_at: '2025-01-05T00:00:00Z',
    });
    mockUpdateItem.mockImplementation((rowId) =>
      Promise.resolve(item({ id: rowId, status: 'active', completed_at: null })),
    );
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    await act(async () => {
      await result.current.actions.uncompleteTask('c');
    });

    expect(result.current.tasks.every((t) => t.status === 'active')).toBe(true);
    expect(mockUpdateItem).toHaveBeenCalledWith('c', { status: 'active' });
    expect(mockUpdateItem).toHaveBeenCalledWith('p', { status: 'active' });
  });

  it('does NOT reactivate an already-active parent when uncompleting a completed child', async () => {
    // P(active) → C(completed) is the "show completed under an active parent" case. Unchecking
    // C reactivates only C; the active parent is left untouched (walk stops at the first
    // active ancestor).
    const parent = item({ id: 'p', status: 'active' });
    const child = item({
      id: 'c',
      parent_id: 'p',
      status: 'completed',
      completed_at: '2025-01-05T00:00:00Z',
    });
    mockUpdateItem.mockResolvedValue(item({ id: 'c', status: 'active', completed_at: null }));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    await act(async () => {
      await result.current.actions.uncompleteTask('c');
    });

    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    expect(mockUpdateItem).toHaveBeenCalledWith('c', { status: 'active' });
  });
});

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------

describe('updateTask', () => {
  it('patches optimistically and reconciles with the server row', async () => {
    mockUpdateItem.mockResolvedValue(item({ id: 'item-1', notes: 'from server' }));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([item({ id: 'item-1' })]) });

    await act(async () => {
      await result.current.actions.updateTask('item-1', { notes: 'typed' });
    });

    expect(result.current.tasks[0]?.notes).toBe('from server');
  });

  it('applies the optimistic patch to the correct item when multiple items exist', () => {
    // find predicate must use item.id === id (not () => true which patches first item)
    const itemA = item({ id: 'item-a', notes: 'original-a' });
    const itemB = item({ id: 'item-b', notes: 'original-b' });
    mockUpdateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([itemA, itemB]) });

    act(() => {
      void result.current.actions.updateTask('item-b', { notes: 'updated-b' });
    });

    // item-a must be unchanged; item-b must have the new notes
    expect(result.current.tasks[0]?.notes).toBe('original-a');
    expect(result.current.tasks[1]?.notes).toBe('updated-b');
  });

  it('patches the correct item id (ids must include the target id)', () => {
    // `dispatch({ type: 'patch', ids: [id], ... })` must not dispatch `ids: []`
    const taskA = item({ id: 'item-a', notes: 'original-a' });
    mockUpdateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([taskA]) });

    act(() => {
      void result.current.actions.updateTask('item-a', { notes: 'new-notes' });
    });

    // The item must have been patched (not a no-op from empty ids)
    expect(result.current.tasks[0]?.notes).toBe('new-notes');
  });

  it('rolls back the patched field on failure', async () => {
    mockUpdateItem.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'item-1', notes: 'original' })]),
    });

    await act(async () => {
      await result.current.actions.updateTask('item-1', { notes: 'typed' }).catch(() => {});
    });

    expect(result.current.tasks[0]?.notes).toBe('original');
  });

  it('rolls back the correct item when two items exist and the second one fails', async () => {
    // find predicate must use item.id === id (not () => true which captures first item)
    // With () => true: previous = item-a, rollback patches item-b with item-a's notes = 'notes-a'
    // With correct predicate: previous = item-b, rollback patches item-b with 'notes-b'
    const itemA = item({ id: 'item-a', notes: 'notes-a' });
    const itemB = item({ id: 'item-b', notes: 'notes-b' });
    mockUpdateItem.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([itemA, itemB]),
    });

    await act(async () => {
      await result.current.actions.updateTask('item-b', { notes: 'typed-b' }).catch(() => {});
    });

    // item-a must be unchanged; item-b must be rolled back to 'notes-b' (NOT 'notes-a')
    expect(result.current.tasks[0]?.notes).toBe('notes-a');
    expect(result.current.tasks[1]?.notes).toBe('notes-b');
  });

  it('does not perform a rollback dispatch when the id is not in the store and request fails', async () => {
    // if (previous) guard prevents rollback for unknown ids that would cause a phantom entry
    const networkError = new Error('network');
    mockUpdateItem.mockRejectedValue(networkError);
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'item-1', notes: 'original' })]),
    });
    let caughtError: unknown;

    await act(async () => {
      try {
        await result.current.actions.updateTask('does-not-exist', { notes: 'typed' });
      } catch (error) {
        caughtError = error;
      }
    });

    // original item unchanged, and the original error is preserved
    expect(result.current.tasks[0]?.notes).toBe('original');
    expect(caughtError).toBe(networkError);
  });

  it('captures the pre-update state from the ref so a subsequent update rolls back correctly', async () => {
    // Exercises the tasksRef sync — stale ref would roll back to wrong value
    const firstServer = item({ id: 'item-1', notes: 'from-server-1' });
    mockUpdateItem.mockResolvedValueOnce(firstServer).mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'item-1', notes: 'original' })]),
    });

    // First update succeeds
    await act(async () => {
      await result.current.actions.updateTask('item-1', { notes: 'typed-1' });
    });
    expect(result.current.tasks[0]?.notes).toBe('from-server-1');

    // Second update fails: should roll back to 'from-server-1', not to 'original'
    await act(async () => {
      await result.current.actions.updateTask('item-1', { notes: 'typed-2' }).catch(() => {});
    });
    expect(result.current.tasks[0]?.notes).toBe('from-server-1');
  });
});

// ---------------------------------------------------------------------------
// classifyItem — inbox triage: flip item_type only. Mirrors updateTask's
// optimistic patch → reconcile → rollback, but is its own action so the field
// isn't exposed on TaskFieldPatch (only this gate may change item_type).
// ---------------------------------------------------------------------------

describe('classifyItem', () => {
  it('patches item_type optimistically before the request resolves', () => {
    mockUpdateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'item-1', item_type: 'unclassified' })]),
    });

    act(() => {
      void result.current.actions.classifyItem('item-1', 'code');
    });

    expect(result.current.tasks[0]?.item_type).toBe('code');
  });

  it('sends the new item_type to the API and reconciles with the server row', async () => {
    mockUpdateItem.mockResolvedValue(item({ id: 'item-1', item_type: 'task' }));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'item-1', item_type: 'unclassified' })]),
    });

    await act(async () => {
      await result.current.actions.classifyItem('item-1', 'task');
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { item_type: 'task' });
    expect(result.current.tasks[0]?.item_type).toBe('task');
  });

  it('patches the targeted item, leaving the others untouched', () => {
    const a = item({ id: 'item-a', item_type: 'unclassified' });
    const b = item({ id: 'item-b', item_type: 'unclassified' });
    mockUpdateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([a, b]) });

    act(() => {
      void result.current.actions.classifyItem('item-b', 'code');
    });

    expect(result.current.tasks[0]?.item_type).toBe('unclassified');
    expect(result.current.tasks[1]?.item_type).toBe('code');
  });

  it('rolls back to the prior item_type on failure', async () => {
    mockUpdateItem.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'item-1', item_type: 'unclassified' })]),
    });

    await act(async () => {
      await result.current.actions.classifyItem('item-1', 'code').catch(() => {});
    });

    expect(result.current.tasks[0]?.item_type).toBe('unclassified');
  });

  it('does not roll back (no phantom row) when the id is absent, and preserves the error', async () => {
    const networkError = new Error('network');
    mockUpdateItem.mockRejectedValue(networkError);
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'item-1', item_type: 'unclassified' })]),
    });
    let caught: unknown;

    await act(async () => {
      try {
        await result.current.actions.classifyItem('does-not-exist', 'code');
      } catch (error) {
        caught = error;
      }
    });

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]?.item_type).toBe('unclassified');
    expect(caught).toBe(networkError);
  });
});

// ---------------------------------------------------------------------------
// bulkClassify — fan the per-item classify route out over a whole set, settling
// each independently so a partial failure rolls back only the failed items.
// ---------------------------------------------------------------------------

describe('bulkClassify', () => {
  const a = item({ id: 'a', item_type: 'unclassified' });
  const b = item({ id: 'b', item_type: 'unclassified' });

  it('patches item_type on the whole set optimistically before the requests resolve', () => {
    mockUpdateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([a, b]) });

    act(() => {
      void result.current.actions.bulkClassify(['a', 'b'], 'task');
    });

    expect(result.current.tasks.every((t) => t.item_type === 'task')).toBe(true);
  });

  it('calls the API per id and reconciles with each server row, resolving with no failures', async () => {
    mockUpdateItem.mockImplementation((id) => Promise.resolve(item({ id, item_type: 'task' })));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([a, b]) });

    let failed: string[] = ['sentinel'];
    await act(async () => {
      failed = await result.current.actions.bulkClassify(['a', 'b'], 'task');
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('a', { item_type: 'task' });
    expect(mockUpdateItem).toHaveBeenCalledWith('b', { item_type: 'task' });
    expect(result.current.tasks.every((t) => t.item_type === 'task')).toBe(true);
    expect(failed).toEqual([]);
  });

  it('leaves saved items applied, rolls back only the failed one, and reports it', async () => {
    // 'a' saves, 'b' fails — a partial failure.
    mockUpdateItem.mockImplementation((id) =>
      id === 'b'
        ? Promise.reject(new Error('network'))
        : Promise.resolve(item({ id, item_type: 'code' })),
    );
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([a, b]) });

    let failed: string[] = [];
    await act(async () => {
      failed = await result.current.actions.bulkClassify(['a', 'b'], 'code');
    });

    const byId = Object.fromEntries(result.current.tasks.map((t) => [t.id, t.item_type]));
    expect(byId['a']).toBe('code'); // saved stays applied
    expect(byId['b']).toBe('unclassified'); // failed rolls back
    expect(failed).toEqual(['b']);
    expect(mockShowToast).toHaveBeenCalledWith("1 of 2 couldn't be classified");
  });

  it('is a no-op (no API call) when no id is in the store', async () => {
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([a]) });

    let failed: string[] = ['sentinel'];
    await act(async () => {
      failed = await result.current.actions.bulkClassify(['ghost'], 'task');
    });

    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(failed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The coherent type change (ALF-170): item_type travels with the clears the new
// type forbids, chosen from the row's CURRENT type.
// ---------------------------------------------------------------------------

describe('classifyItem sends one coherent write', () => {
  it('task → code clears the due date and recurrence in the same PATCH', async () => {
    const rule = { freq: 'daily', interval: 1, end: { type: 'never' } };
    mockUpdateItem.mockResolvedValue(item({ id: 'item-1', item_type: 'code' }));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([
        item({ id: 'item-1', item_type: 'task', due_date: '2026-08-14', recurrence: rule }),
      ]),
    });

    await act(async () => {
      await result.current.actions.classifyItem('item-1', 'code');
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', {
      item_type: 'code',
      due_date: null,
      recurrence: null,
    });
  });

  it('code → task clears both pre-factory hints in the same PATCH', async () => {
    mockUpdateItem.mockResolvedValue(item({ id: 'item-1', item_type: 'task' }));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([
        item({
          id: 'item-1',
          item_type: 'code',
          intended_project_id: 'p1',
          intended_epic_id: 'e1',
        }),
      ]),
    });

    await act(async () => {
      await result.current.actions.classifyItem('item-1', 'task');
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', {
      item_type: 'task',
      intended_project_id: null,
      intended_epic_id: null,
    });
  });

  it('leaves priority alone in both directions', async () => {
    // No constraint forbids a priority on a code row, and a mis-classification corrected
    // straight back keeps the level the owner set.
    mockUpdateItem.mockResolvedValue(item({ id: 'item-1', item_type: 'code', priority: 'high' }));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'item-1', item_type: 'task', priority: 'high' })]),
    });

    await act(async () => {
      await result.current.actions.classifyItem('item-1', 'code');
    });

    const sent = mockUpdateItem.mock.calls[0]?.[1];
    expect(sent).not.toHaveProperty('priority');
    expect(result.current.tasks[0]?.priority).toBe('high');
  });

  it('applies the clears optimistically before the request resolves', () => {
    mockUpdateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'item-1', item_type: 'task', due_date: '2026-08-14' })]),
    });

    act(() => {
      void result.current.actions.classifyItem('item-1', 'code');
    });

    expect(result.current.tasks[0]?.item_type).toBe('code');
    expect(result.current.tasks[0]?.due_date).toBeNull();
  });
});

describe('bulkClassify sends each row its own clear-set', () => {
  it('a mixed selection gets per-row patches, not one shared object', async () => {
    // The task carries a due date to clear; the unclassified row has nothing to clear, so its
    // flip stays a bare item_type patch.
    mockUpdateItem.mockImplementation((id) => Promise.resolve(item({ id, item_type: 'code' })));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([
        item({ id: 'was-task', item_type: 'task', due_date: '2026-08-14' }),
        item({ id: 'was-unclassified', item_type: 'unclassified' }),
      ]),
    });

    await act(async () => {
      await result.current.actions.bulkClassify(['was-task', 'was-unclassified'], 'code');
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('was-task', {
      item_type: 'code',
      due_date: null,
      recurrence: null,
    });
    expect(mockUpdateItem).toHaveBeenCalledWith('was-unclassified', { item_type: 'code' });
  });
});

// ---------------------------------------------------------------------------
// setFolder — the label write (ALF-170): folder_id cascades over the subtree,
// residency is never touched, so an Inbox row stays in the Inbox.
// ---------------------------------------------------------------------------

describe('setFolder', () => {
  const parent = item({ id: 'parent', item_type: 'task' });
  const child = item({ id: 'child', item_type: 'task', parent_id: 'parent' });

  it('cascades folder_id over the subtree and writes no residency field', async () => {
    mockUpdateItem.mockImplementation((id) =>
      Promise.resolve(item({ id, item_type: 'task', folder_id: 'f1', dispatched_at: null })),
    );
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    await act(async () => {
      await result.current.actions.setFolder('parent', 'f1');
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('parent', { folder_id: 'f1' });
    expect(mockUpdateItem).toHaveBeenCalledWith('child', { folder_id: 'f1' });
    for (const call of mockUpdateItem.mock.calls) {
      expect(call[1]).not.toHaveProperty('dispatched');
      expect(call[1]).not.toHaveProperty('dispatched_at');
    }
  });

  it('labels the row optimistically while leaving it in the Inbox', () => {
    mockUpdateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    act(() => {
      void result.current.actions.setFolder('parent', 'f1');
    });

    expect(result.current.tasks.every((t) => t.folder_id === 'f1')).toBe(true);
    expect(result.current.tasks.every((t) => t.dispatched_at === null)).toBe(true);
  });

  it('restores the subtree on failure', async () => {
    mockUpdateItem.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    await act(async () => {
      await result.current.actions.setFolder('parent', 'f1').catch(() => {});
    });

    expect(result.current.tasks.every((t) => t.folder_id === null)).toBe(true);
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't save changes");
  });
});

// ---------------------------------------------------------------------------
// The pre-factory hint writes (ALF-170).
// ---------------------------------------------------------------------------

describe('setIntendedProject', () => {
  it('clears the epic hint in the same PATCH when the project changes', async () => {
    mockUpdateItem.mockResolvedValue(
      item({ id: 'item-1', item_type: 'code', intended_project_id: 'p2' }),
    );
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([
        item({
          id: 'item-1',
          item_type: 'code',
          intended_project_id: 'p1',
          intended_epic_id: 'e1',
        }),
      ]),
    });

    await act(async () => {
      await result.current.actions.setIntendedProject('item-1', 'p2');
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', {
      intended_project_id: 'p2',
      intended_epic_id: null,
    });
  });

  it('clears both hints when the project is cleared', async () => {
    mockUpdateItem.mockResolvedValue(item({ id: 'item-1', item_type: 'code' }));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'item-1', item_type: 'code', intended_project_id: 'p1' })]),
    });

    await act(async () => {
      await result.current.actions.setIntendedProject('item-1', null);
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', {
      intended_project_id: null,
      intended_epic_id: null,
    });
  });

  it('rolls the row back on failure', async () => {
    mockUpdateItem.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([
        item({
          id: 'item-1',
          item_type: 'code',
          intended_project_id: 'p1',
          intended_epic_id: 'e1',
        }),
      ]),
    });

    await act(async () => {
      await result.current.actions.setIntendedProject('item-1', 'p2').catch(() => {});
    });

    expect(result.current.tasks[0]?.intended_project_id).toBe('p1');
    expect(result.current.tasks[0]?.intended_epic_id).toBe('e1');
  });
});

describe('setIntendedEpic', () => {
  it('patches the epic hint alone and reconciles', async () => {
    mockUpdateItem.mockResolvedValue(
      item({ id: 'item-1', item_type: 'code', intended_project_id: 'p1', intended_epic_id: 'e1' }),
    );
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'item-1', item_type: 'code', intended_project_id: 'p1' })]),
    });

    await act(async () => {
      await result.current.actions.setIntendedEpic('item-1', 'e1');
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { intended_epic_id: 'e1' });
    expect(result.current.tasks[0]?.intended_epic_id).toBe('e1');
  });
});

// ---------------------------------------------------------------------------
// dispatchItems (ALF-170): one press, three outcomes — a ready task PATCHes its
// whole subtree, a ready code item runs the gate RPC and leaves the store, an
// unready item is never sent and comes back to stay selected.
// ---------------------------------------------------------------------------

describe('dispatchItems', () => {
  const readyTask = item({
    id: 'ready-task',
    item_type: 'task',
    folder_id: 'f1',
    dispatched_at: null,
  });
  const taskChild = item({
    id: 'task-child',
    item_type: 'task',
    parent_id: 'ready-task',
    folder_id: 'f1',
    dispatched_at: null,
  });
  const readyCode = item({
    id: 'ready-code',
    title: 'Snooze an item',
    item_type: 'code',
    intended_project_id: 'p1',
    intended_epic_id: 'e1',
  });
  const unready = item({ id: 'unready', item_type: 'task', folder_id: null });

  it('PATCHes a ready task and its whole subtree with the dispatched intent', async () => {
    mockUpdateItem.mockImplementation((id) =>
      Promise.resolve(item({ id, item_type: 'task', folder_id: 'f1' })),
    );
    const sendToCode = jest.fn();
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([readyTask, taskChild]),
    });

    let stay: string[] = ['sentinel'];
    await act(async () => {
      stay = await result.current.actions.dispatchItems(['ready-task'], sendToCode);
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('ready-task', { dispatched: true });
    expect(mockUpdateItem).toHaveBeenCalledWith('task-child', { dispatched: true });
    expect(sendToCode).not.toHaveBeenCalled();
    expect(stay).toEqual([]);
  });

  it('stamps the task subtree optimistically before the requests resolve', () => {
    mockUpdateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([readyTask, taskChild]),
    });

    act(() => {
      void result.current.actions.dispatchItems(['ready-task'], jest.fn());
    });

    expect(result.current.tasks.every((t) => t.dispatched_at !== null)).toBe(true);
  });

  it('sends a ready code item through the gate RPC and drops it from the store', async () => {
    const sendToCode = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([readyCode]) });

    let stay: string[] = ['sentinel'];
    await act(async () => {
      stay = await result.current.actions.dispatchItems(['ready-code'], sendToCode);
    });

    expect(sendToCode).toHaveBeenCalledWith(
      { id: 'ready-code', title: 'Snooze an item', notes: null, source_url: null },
      'p1',
      'e1',
    );
    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(result.current.tasks).toHaveLength(0);
    expect(stay).toEqual([]);
  });

  it('never sends an unready item, returns it to stay selected, and does not count it as a failure', async () => {
    mockUpdateItem.mockImplementation((id) =>
      Promise.resolve(item({ id, item_type: 'task', folder_id: 'f1' })),
    );
    const sendToCode = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([readyTask, taskChild, readyCode, unready]),
    });

    let stay: string[] = [];
    await act(async () => {
      stay = await result.current.actions.dispatchItems(
        ['ready-task', 'ready-code', 'unready'],
        sendToCode,
      );
    });

    expect(stay).toEqual(['unready']);
    expect(mockUpdateItem).not.toHaveBeenCalledWith('unready', expect.anything());
    // The unready row is untouched — still in the Inbox, still undispatched.
    expect(result.current.tasks.find((t) => t.id === 'unready')?.dispatched_at).toBeNull();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('settles a save failure like every other bulk action: rollback, toast, id returned', async () => {
    // The task's subtree PATCH fails; the code item succeeds.
    mockUpdateItem.mockRejectedValue(new Error('network'));
    const sendToCode = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([readyTask, taskChild, readyCode]),
    });

    let stay: string[] = [];
    await act(async () => {
      stay = await result.current.actions.dispatchItems(['ready-task', 'ready-code'], sendToCode);
    });

    expect(stay).toEqual(['ready-task']);
    // The failed subtree rolls back to undispatched; the gated code row is gone.
    expect(result.current.tasks.find((t) => t.id === 'ready-task')?.dispatched_at).toBeNull();
    expect(result.current.tasks.find((t) => t.id === 'task-child')?.dispatched_at).toBeNull();
    expect(result.current.tasks.find((t) => t.id === 'ready-code')).toBeUndefined();
    expect(mockShowToast).toHaveBeenCalledWith("1 of 2 couldn't be dispatched");
  });

  it('keeps a failed code item in the store and returns it', async () => {
    const sendToCode = jest.fn().mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([readyCode]) });

    let stay: string[] = [];
    await act(async () => {
      stay = await result.current.actions.dispatchItems(['ready-code'], sendToCode);
    });

    expect(stay).toEqual(['ready-code']);
    expect(result.current.tasks.find((t) => t.id === 'ready-code')).toBeDefined();
    expect(mockShowToast).toHaveBeenCalledWith("1 of 1 couldn't be dispatched");
  });
});

// ---------------------------------------------------------------------------
// moveTask (cascades) + deleteTask (cascades)
// ---------------------------------------------------------------------------

describe('moveTask', () => {
  const parent = item({ id: 'item-1' });
  const child = item({ id: 'c-1', parent_id: 'item-1' });

  it('patches the folder on the whole subtree and calls updateItem for each', async () => {
    mockUpdateItem.mockResolvedValue({ ...parent, folder_id: 'folder-2' });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    await act(async () => {
      await result.current.actions.moveTask('item-1', 'folder-2');
    });

    expect(result.current.tasks.every((t) => t.folder_id === 'folder-2')).toBe(true);
    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', {
      folder_id: 'folder-2',
      dispatched: true,
    });
    expect(mockUpdateItem).toHaveBeenCalledWith('c-1', {
      folder_id: 'folder-2',
      dispatched: true,
    });
  });

  it('dispatches the whole subtree optimistically, so it lands in the folder view at once', () => {
    // Hold the API promise open: the assertion is about the OPTIMISTIC patch, before the server
    // rows reconcile. Without residency in that patch the subtree would sit in the Inbox until
    // the round-trip landed, then jump.
    mockUpdateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    expect(result.current.tasks.every((t) => t.dispatched_at === null)).toBe(true);

    act(() => void result.current.actions.moveTask('item-1', 'folder-2'));

    expect(result.current.tasks.every((t) => t.dispatched_at !== null)).toBe(true);
  });

  it('uses moveToInbox when the target is null', async () => {
    mockMoveToInbox.mockResolvedValue({ ...parent, folder_id: null });
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'item-1', folder_id: 'folder-9' })]),
    });

    await act(async () => {
      await result.current.actions.moveTask('item-1', null);
    });

    expect(mockMoveToInbox).toHaveBeenCalledWith('item-1');
  });

  it('clears residency along with the folder when moving back to the Inbox', async () => {
    // Un-filing undoes the filing: keeping either field would leave the row rendering in the
    // folder it was just pulled out of.
    mockMoveToInbox.mockResolvedValue({
      ...item({ id: 'item-1' }),
      folder_id: null,
      dispatched_at: null,
    });
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'item-1', folder_id: 'folder-9' })]),
    });

    await act(async () => {
      await result.current.actions.moveTask('item-1', null);
    });

    expect(result.current.tasks[0]?.folder_id).toBeNull();
    expect(result.current.tasks[0]?.dispatched_at).toBeNull();
  });

  it('is a no-op and does not call the API when the id is not in the store', async () => {
    // Guard: if (affected.length === 0) return
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent]) });

    await act(async () => {
      await result.current.actions.moveTask('does-not-exist', 'folder-2');
    });

    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(mockMoveToInbox).not.toHaveBeenCalled();
  });

  it('restores the original folder on the subtree when move fails', async () => {
    // Covers the rollback catch block (line 194-196)
    mockUpdateItem.mockRejectedValue(new Error('network'));
    const parentInFolder = item({ id: 'item-1', folder_id: 'old-folder' });
    const childInFolder = item({ id: 'c-1', parent_id: 'item-1', folder_id: 'old-folder' });
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([parentInFolder, childInFolder]),
    });

    await act(async () => {
      await result.current.actions.moveTask('item-1', 'new-folder').catch(() => {});
    });

    // Both items must be restored to 'old-folder'
    expect(result.current.tasks.every((t) => t.folder_id === 'old-folder')).toBe(true);
  });

  // ALF-72: filing an unclassified inbox item into a folder must also classify it as a task —
  // folders hold tasks, so a bare folder move would strand it in a folder still unclassified.
  it('classifies an unclassified item as a task when filed into a folder', async () => {
    const unclassified = item({ id: 'u-1', item_type: 'unclassified', folder_id: null });
    mockUpdateItem.mockResolvedValue({
      ...unclassified,
      item_type: 'task',
      folder_id: 'folder-2',
    });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([unclassified]) });

    await act(async () => {
      await result.current.actions.moveTask('u-1', 'folder-2');
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('u-1', {
      folder_id: 'folder-2',
      item_type: 'task',
      dispatched: true,
    });
    expect(result.current.tasks[0]?.item_type).toBe('task');
    expect(result.current.tasks[0]?.folder_id).toBe('folder-2');
  });

  it('flips the item type optimistically before the request resolves', () => {
    const unclassified = item({ id: 'u-1', item_type: 'unclassified', folder_id: null });
    mockUpdateItem.mockReturnValue(new Promise(() => {})); // never settles
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([unclassified]) });

    act(() => {
      void result.current.actions.moveTask('u-1', 'folder-2');
    });

    expect(result.current.tasks[0]?.item_type).toBe('task');
    expect(result.current.tasks[0]?.folder_id).toBe('folder-2');
  });

  it('does not classify an unclassified item when moved to the Inbox (null target)', async () => {
    const unclassified = item({ id: 'u-1', item_type: 'unclassified', folder_id: 'folder-9' });
    mockMoveToInbox.mockResolvedValue({ ...unclassified, folder_id: null });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([unclassified]) });

    await act(async () => {
      await result.current.actions.moveTask('u-1', null);
    });

    expect(mockMoveToInbox).toHaveBeenCalledWith('u-1');
    expect(result.current.tasks[0]?.item_type).toBe('unclassified');
  });

  it('leaves an already-classified task type untouched when filed into a folder', async () => {
    const task = item({ id: 'item-1', item_type: 'task', folder_id: null });
    mockUpdateItem.mockResolvedValue({ ...task, folder_id: 'folder-2' });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([task]) });

    await act(async () => {
      await result.current.actions.moveTask('item-1', 'folder-2');
    });

    // No item_type in the payload — a task stays a task.
    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', {
      folder_id: 'folder-2',
      dispatched: true,
    });
    expect(result.current.tasks[0]?.item_type).toBe('task');
  });
});

// ---------------------------------------------------------------------------
// bulkMove — file a set of tasks (each cascading its subtree) into one folder,
// settling each root independently so a partial failure leaves the rest filed.
// ---------------------------------------------------------------------------

describe('bulkMove', () => {
  it('moves every selected root and its subtree, resolving with no failures', async () => {
    mockUpdateItem.mockImplementation((id) => Promise.resolve(item({ id, folder_id: 'folder-2' })));
    const root1 = item({ id: 'r1' });
    const child = item({ id: 'c1', parent_id: 'r1' });
    const root2 = item({ id: 'r2' });
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([root1, child, root2]),
    });

    let failed: string[] = ['sentinel'];
    await act(async () => {
      failed = await result.current.actions.bulkMove(['r1', 'r2'], 'folder-2');
    });

    expect(result.current.tasks.every((t) => t.folder_id === 'folder-2')).toBe(true);
    expect(mockUpdateItem).toHaveBeenCalledWith('c1', {
      folder_id: 'folder-2',
      dispatched: true,
    });
    expect(failed).toEqual([]);
  });

  it('uses moveToInbox for each item when filing back to the Inbox (null target)', async () => {
    mockMoveToInbox.mockImplementation((id) => Promise.resolve(item({ id, folder_id: null })));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'r1', folder_id: 'folder-9' })]),
    });

    await act(async () => {
      await result.current.actions.bulkMove(['r1'], null);
    });

    expect(mockMoveToInbox).toHaveBeenCalledWith('r1');
  });

  it('rolls back only the failed root, leaving the filed one applied, and reports it', async () => {
    // r1 files into folder-2; r2 fails and snaps back to its original folder.
    mockUpdateItem.mockImplementation((id) =>
      id === 'r2'
        ? Promise.reject(new Error('network'))
        : Promise.resolve(item({ id, folder_id: 'folder-2' })),
    );
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([
        item({ id: 'r1', folder_id: null }),
        item({ id: 'r2', folder_id: null }),
      ]),
    });

    let failed: string[] = [];
    await act(async () => {
      failed = await result.current.actions.bulkMove(['r1', 'r2'], 'folder-2');
    });

    const byId = Object.fromEntries(result.current.tasks.map((t) => [t.id, t.folder_id]));
    expect(byId['r1']).toBe('folder-2'); // filed stays applied
    expect(byId['r2']).toBe(null); // failed rolls back to the Inbox
    expect(failed).toEqual(['r2']);
    expect(mockShowToast).toHaveBeenCalledWith("1 of 2 couldn't be filed");
  });

  it('is a no-op (no API call) when no id is in the store', async () => {
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'r1' })]),
    });

    let failed: string[] = ['sentinel'];
    await act(async () => {
      failed = await result.current.actions.bulkMove(['ghost'], 'folder-2');
    });

    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(mockMoveToInbox).not.toHaveBeenCalled();
    expect(failed).toEqual([]);
  });
});

describe('reparentTask', () => {
  it('sets the new parent and has the whole subtree adopt the new parent folder', async () => {
    const dragged = item({ id: 'd1', folder_id: null });
    const child = item({ id: 'd1-c', parent_id: 'd1', folder_id: null });
    const target = item({ id: 'p1', folder_id: 'folder-9' });
    mockUpdateItem.mockImplementation((id: string) =>
      Promise.resolve(item({ id, parent_id: id === 'd1' ? 'p1' : 'd1', folder_id: 'folder-9' })),
    );
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([dragged, child, target]),
    });

    await act(async () => {
      await result.current.actions.reparentTask('d1', 'p1');
    });

    const draggedAfter = result.current.tasks.find((t) => t.id === 'd1');
    expect(draggedAfter?.parent_id).toBe('p1');
    expect(mockUpdateItem).toHaveBeenCalledWith('d1', {
      parent_id: 'p1',
      folder_id: 'folder-9',
      dispatched: true,
    });
    // The subtree adopts the new parent's folder.
    expect(mockUpdateItem).toHaveBeenCalledWith('d1-c', {
      folder_id: 'folder-9',
      dispatched: true,
    });
    expect(result.current.tasks.every((t) => t.id === 'p1' || t.folder_id === 'folder-9')).toBe(
      true,
    );
  });

  it('only updates parent_id (no descendant folder writes) when the folder is unchanged', async () => {
    const dragged = item({ id: 'd1', folder_id: 'folder-1' });
    const child = item({ id: 'd1-c', parent_id: 'd1', folder_id: 'folder-1' });
    const target = item({ id: 'p1', folder_id: 'folder-1' });
    mockUpdateItem.mockResolvedValue(item({ id: 'd1', parent_id: 'p1', folder_id: 'folder-1' }));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([dragged, child, target]),
    });

    await act(async () => {
      await result.current.actions.reparentTask('d1', 'p1');
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('d1', {
      parent_id: 'p1',
      folder_id: 'folder-1',
      dispatched: true,
    });
    // Same folder AND same residency → the child is not PATCHed.
    expect(mockUpdateItem).not.toHaveBeenCalledWith('d1-c', {
      folder_id: 'folder-1',
      dispatched: true,
    });
  });

  it('cascades to the subtree on a residency-only change — same folder, different view', async () => {
    // The undispatched rows already point at folder-1 but render in the Inbox. Nesting them
    // under a filed task there changes which view the subtree lives in even though `folder_id`
    // never moves, so the descendants have to be written too — otherwise the child stays in
    // the Inbox while its parent leaves, and the orphan renders nowhere.
    const dragged = item({ id: 'd1', folder_id: 'folder-1', dispatched_at: null });
    const child = item({ id: 'd1-c', parent_id: 'd1', folder_id: 'folder-1', dispatched_at: null });
    const target = item({ id: 'p1', folder_id: 'folder-1' });
    mockUpdateItem.mockImplementation((id: string) =>
      Promise.resolve(item({ id, folder_id: 'folder-1' })),
    );
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([dragged, child, target]),
    });

    await act(async () => {
      await result.current.actions.reparentTask('d1', 'p1');
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('d1', {
      parent_id: 'p1',
      folder_id: 'folder-1',
      dispatched: true,
    });
    expect(mockUpdateItem).toHaveBeenCalledWith('d1-c', {
      folder_id: 'folder-1',
      dispatched: true,
    });
  });

  it('is a no-op when the target parent is not in the store', async () => {
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([item({ id: 'd1' })]) });

    await act(async () => {
      await result.current.actions.reparentTask('d1', 'missing');
    });

    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('is a no-op when the dragged task is not in the store', async () => {
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([item({ id: 'p1' })]) });

    await act(async () => {
      await result.current.actions.reparentTask('missing', 'p1');
    });

    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('restores the original parent and folder when the re-parent fails', async () => {
    mockUpdateItem.mockRejectedValue(new Error('network'));
    const dragged = item({ id: 'd1', parent_id: null, folder_id: null });
    const target = item({ id: 'p1', folder_id: 'folder-9' });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([dragged, target]) });

    await act(async () => {
      await result.current.actions.reparentTask('d1', 'p1').catch(() => {});
    });

    const draggedAfter = result.current.tasks.find((t) => t.id === 'd1');
    expect(draggedAfter?.parent_id).toBeNull();
    expect(draggedAfter?.folder_id).toBeNull();
  });

  // Cycle guards — a task may never become its own parent or a child of its own
  // descendant. Without these, the bad parent_id makes buildTree drop the subtree and the
  // task (and its children) silently vanish — and the corruption persists to the server.
  it('is a no-op when dropped onto itself (would self-parent)', async () => {
    const dragged = item({ id: 'd1', parent_id: null });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([dragged]) });

    await act(async () => {
      await result.current.actions.reparentTask('d1', 'd1');
    });

    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(result.current.tasks.find((t) => t.id === 'd1')?.parent_id).toBeNull();
  });

  it('is a no-op when dropped onto one of its own descendants (would make a cycle)', async () => {
    const dragged = item({ id: 'd1', parent_id: null });
    const child = item({ id: 'd1-c', parent_id: 'd1' });
    const grandchild = item({ id: 'd1-gc', parent_id: 'd1-c' });
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([dragged, child, grandchild]),
    });

    await act(async () => {
      await result.current.actions.reparentTask('d1', 'd1-gc');
    });

    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(result.current.tasks.find((t) => t.id === 'd1')?.parent_id).toBeNull();
  });

  // Promote to a top-level task: parent_id → null, folder kept.
  it('clears parent_id (keeping the folder) when re-parented to null', async () => {
    const dragged = item({ id: 'd1', parent_id: 'p1', folder_id: 'folder-1' });
    const parent = item({ id: 'p1', folder_id: 'folder-1' });
    mockUpdateItem.mockResolvedValue(item({ id: 'd1', parent_id: null, folder_id: 'folder-1' }));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([dragged, parent]) });

    await act(async () => {
      await result.current.actions.reparentTask('d1', null);
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('d1', { parent_id: null });
    const draggedAfter = result.current.tasks.find((t) => t.id === 'd1');
    expect(draggedAfter?.parent_id).toBeNull();
    expect(draggedAfter?.folder_id).toBe('folder-1');
  });

  it('is a no-op when promoting a task that is already top-level', async () => {
    const dragged = item({ id: 'd1', parent_id: null });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([dragged]) });

    await act(async () => {
      await result.current.actions.reparentTask('d1', null);
    });

    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('restores the original parent when a promote-to-root fails', async () => {
    mockUpdateItem.mockRejectedValue(new Error('network'));
    const dragged = item({ id: 'd1', parent_id: 'p1', folder_id: 'folder-1' });
    const parent = item({ id: 'p1', folder_id: 'folder-1' });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([dragged, parent]) });

    await act(async () => {
      await result.current.actions.reparentTask('d1', null).catch(() => {});
    });

    expect(result.current.tasks.find((t) => t.id === 'd1')?.parent_id).toBe('p1');
  });
});

describe('reorderSubtask', () => {
  it('patches only sort_order (no folder/descendant writes) for a same-parent reorder', async () => {
    const parent = item({ id: 'p1', folder_id: 'folder-1' });
    const a = item({ id: 'a', parent_id: 'p1', folder_id: 'folder-1', sort_order: 10 });
    const b = item({ id: 'b', parent_id: 'p1', folder_id: 'folder-1', sort_order: 20 });
    mockUpdateItem.mockResolvedValue(item({ id: 'b', parent_id: 'p1', sort_order: 5 }));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, a, b]) });

    await act(async () => {
      // Move b above a (sort_order 5).
      await result.current.actions.reorderSubtask('b', { parentId: 'p1', sortOrder: 5 });
    });

    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    expect(mockUpdateItem).toHaveBeenCalledWith('b', { sort_order: 5 });
    expect(result.current.tasks.find((t) => t.id === 'b')?.sort_order).toBe(5);
  });

  it('re-parents, cascades the folder to the subtree, AND sets sort_order for a cross-parent drop', async () => {
    const dragged = item({ id: 'd', parent_id: 'p1', folder_id: null, sort_order: 10 });
    const child = item({ id: 'd-c', parent_id: 'd', folder_id: null });
    const target = item({ id: 'p2', folder_id: 'folder-9' });
    mockUpdateItem.mockImplementation((id: string) =>
      Promise.resolve(
        item({ id, parent_id: id === 'd' ? 'p2' : 'd', folder_id: 'folder-9', sort_order: 15 }),
      ),
    );
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([dragged, child, target]),
    });

    await act(async () => {
      await result.current.actions.reorderSubtask('d', { parentId: 'p2', sortOrder: 15 });
    });

    expect(mockUpdateItem).toHaveBeenCalledWith('d', {
      parent_id: 'p2',
      folder_id: 'folder-9',
      dispatched: true,
      sort_order: 15,
    });
    // The subtree adopts the new parent's folder.
    expect(mockUpdateItem).toHaveBeenCalledWith('d-c', {
      folder_id: 'folder-9',
      dispatched: true,
    });
    const draggedAfter = result.current.tasks.find((t) => t.id === 'd');
    expect(draggedAfter?.parent_id).toBe('p2');
  });

  it('is a no-op when the target parent is one of the dragged row’s own descendants (cycle)', async () => {
    const dragged = item({ id: 'd', parent_id: 'p1' });
    const child = item({ id: 'd-c', parent_id: 'd' });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([dragged, child]) });

    await act(async () => {
      await result.current.actions.reorderSubtask('d', { parentId: 'd-c', sortOrder: 1 });
    });

    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('is a no-op when the dragged task is not in the store', async () => {
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([item({ id: 'p1' })]) });

    await act(async () => {
      await result.current.actions.reorderSubtask('missing', { parentId: 'p1', sortOrder: 1 });
    });

    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('rolls the row back and restores its sort_order when the reorder fails', async () => {
    mockUpdateItem.mockRejectedValue(new Error('network'));
    const parent = item({ id: 'p1' });
    const a = item({ id: 'a', parent_id: 'p1', sort_order: 10 });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, a]) });

    await act(async () => {
      await result.current.actions
        .reorderSubtask('a', { parentId: 'p1', sortOrder: 99 })
        .catch(() => {});
    });

    expect(result.current.tasks.find((t) => t.id === 'a')?.sort_order).toBe(10);
  });
});

describe('deleteTask', () => {
  const parent = item({ id: 'item-1' });
  const child = item({ id: 'c-1', parent_id: 'item-1' });

  it('removes the whole subtree (the DB cascades) and calls deleteItem on the root', async () => {
    mockDeleteItem.mockResolvedValue({ success: true });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    await act(async () => {
      await result.current.actions.deleteTask('item-1');
    });

    expect(result.current.tasks).toStrictEqual([]);
    expect(mockDeleteItem).toHaveBeenCalledWith('item-1');
  });

  it('restores the subtree when deletion fails', async () => {
    mockDeleteItem.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    await act(async () => {
      await result.current.actions.deleteTask('item-1').catch(() => {});
    });

    expect(new Set(result.current.tasks.map((t) => t.id))).toStrictEqual(
      new Set(['c-1', 'item-1']),
    );
  });

  it('is a no-op and does not call the API when the id is not in the store', async () => {
    // Guard: if (affected.length === 0) return
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent]) });

    await act(async () => {
      await result.current.actions.deleteTask('does-not-exist');
    });

    expect(mockDeleteItem).not.toHaveBeenCalled();
    // Store unchanged
    expect(result.current.tasks).toHaveLength(1);
  });
});

describe('settleEpicConversion', () => {
  it('drops the children and the parent for a converted code parent (removed)', () => {
    const parent = item({ id: 'code-parent', item_type: 'code' });
    const children = [
      item({ id: 'c-1', item_type: 'code', parent_id: 'code-parent' }),
      item({ id: 'c-2', item_type: 'code', parent_id: 'code-parent' }),
    ];
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, ...children]) });

    act(() => {
      result.current.actions.settleEpicConversion({
        parentId: 'code-parent',
        childIds: ['c-1', 'c-2'],
        parentOutcome: 'removed',
      });
    });

    expect(result.current.tasks).toStrictEqual([]);
  });

  it('completes a task parent, dropping its converted children but keeping completed ones', () => {
    const parent = item({ id: 'task-parent' });
    const active = item({ id: 'c-1', parent_id: 'task-parent' });
    const done = item({
      id: 'c-done',
      parent_id: 'task-parent',
      status: 'completed',
      completed_at: '2025-01-02T00:00:00Z',
    });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, active, done]) });

    act(() => {
      result.current.actions.settleEpicConversion({
        parentId: 'task-parent',
        childIds: ['c-1'],
        parentOutcome: 'completed',
      });
    });

    const ids = result.current.tasks.map((t) => t.id);
    expect(new Set(ids)).toStrictEqual(new Set(['task-parent', 'c-done']));
    const settledParent = result.current.tasks.find((t) => t.id === 'task-parent');
    expect(settledParent?.status).toBe('completed');
    expect(settledParent?.completed_at).not.toBeNull();
  });

  it('never calls the API (a pure client-side settlement)', () => {
    const parent = item({ id: 'code-parent', item_type: 'code' });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent]) });

    act(() => {
      result.current.actions.settleEpicConversion({
        parentId: 'code-parent',
        childIds: [],
        parentOutcome: 'removed',
      });
    });

    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(mockDeleteItem).not.toHaveBeenCalled();
    expect(mockCompleteTask).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useScopedTasks (client-side filtering)
// ---------------------------------------------------------------------------

describe('useScopedTasks', () => {
  const items: Item[] = [
    item({ id: 'inbox-active' }),
    item({ id: 'inbox-done', status: 'completed' }),
    item({ id: 'work-active', folder_id: 'work' }),
    item({ id: 'work-done', folder_id: 'work', status: 'completed' }),
    item({ id: 'work-child', folder_id: 'work', parent_id: 'work-active' }),
  ];

  function renderScope(scope: TaskScope) {
    return renderHook(() => useScopedTasks(scope), { wrapper: makeWrapper(items) });
  }

  it('inbox = active, folder-less items', () => {
    const { result } = renderScope({ type: 'inbox' });
    expect(result.current.map((n) => n.id)).toStrictEqual(['inbox-active']);
  });

  it('inbox scope excludes items with a folder_id (even if active)', () => {
    // If scopeType === 'folder' guard is mutated to `if (true)`, inbox would be
    // treated as a folder scope with folderId = null, filtering `folder_id === null`
    // instead of the proper inbox predicate — but the result would be the same.
    // The key distinguisher is that inbox must NOT include folder items.
    const { result } = renderScope({ type: 'inbox' });
    const ids = result.current.map((n) => n.id);
    expect(ids).not.toContain('work-active');
    expect(ids).not.toContain('work-child');
  });

  it('inbox scope excludes completed items', () => {
    // The `item.status === 'active'` predicate must be intact — mutating to `true`
    // would include completed inbox items.
    const { result } = renderScope({ type: 'inbox' });
    const ids = result.current.map((n) => n.id);
    expect(ids).not.toContain('inbox-done');
  });

  it('folder = active items in that folder, nested into a tree', () => {
    const { result } = renderScope({ type: 'folder', folderId: 'work' });
    expect(result.current.map((n) => n.id)).toStrictEqual(['work-active']);
    expect(result.current[0]?.children.map((c) => c.id)).toStrictEqual(['work-child']);
  });

  it('folder scope excludes completed items in the folder', () => {
    // `item.status === 'active'` must be asserted for folder scope too
    const { result } = renderScope({ type: 'folder', folderId: 'work' });
    const ids = result.current.map((n) => n.id);
    expect(ids).not.toContain('work-done');
  });

  it('folder scope uses the correct folderId (not the always-truthy condition)', () => {
    // `scope.type === 'folder' ? scope.folderId : null` mutated to `true ? scope.folderId : null`
    // would always use scope.folderId even for inbox/completed — leading to wrong filtering.
    // This test uses inbox scope with no items in that folder — would fail if folderId leaks.
    const { result } = renderScope({ type: 'inbox' });
    // Only inbox-active should appear — not work-active (which has folder_id: 'work')
    expect(result.current.map((n) => n.id)).toStrictEqual(['inbox-active']);
  });

  it('folder ranks top-level tasks by priority → due → created_at (ALF-37)', () => {
    const ranked: Item[] = [
      item({ id: 'f-none', folder_id: 'work' }),
      item({ id: 'f-low', folder_id: 'work', priority: 'low' }),
      item({ id: 'f-high', folder_id: 'work', priority: 'high' }),
      item({ id: 'f-med', folder_id: 'work', priority: 'medium' }),
    ];
    const { result } = renderHook(() => useScopedTasks({ type: 'folder', folderId: 'work' }), {
      wrapper: makeWrapper(ranked),
    });
    expect(result.current.map((n) => n.id)).toStrictEqual(['f-high', 'f-med', 'f-low', 'f-none']);
  });

  it('folder ranks top-level tasks by due date, undated last, in the due sort mode', () => {
    const ranked: Item[] = [
      item({ id: 'f-undated', folder_id: 'work', priority: 'high' }),
      item({ id: 'f-later', folder_id: 'work', due_date: '2026-09-01' }),
      item({ id: 'f-sooner', folder_id: 'work', due_date: '2026-08-01', priority: 'low' }),
    ];
    const { result } = renderHook(
      () => useScopedTasks({ type: 'folder', folderId: 'work' }, 'due'),
      { wrapper: makeWrapper(ranked) },
    );
    expect(result.current.map((n) => n.id)).toStrictEqual(['f-sooner', 'f-later', 'f-undated']);
  });

  it('inbox ignores the sort mode — capture order is not negotiable', () => {
    const inbox: Item[] = [
      item({ id: 'old-due-soon', created_at: '2025-01-01T00:00:00Z', due_date: '2026-08-01' }),
      item({ id: 'new-undated', created_at: '2025-02-01T00:00:00Z' }),
    ];
    const { result } = renderHook(() => useScopedTasks({ type: 'inbox' }, 'due'), {
      wrapper: makeWrapper(inbox),
    });
    expect(result.current.map((n) => n.id)).toStrictEqual(['new-undated', 'old-due-soon']);
  });

  it('folder orders subtasks by sort_order, NOT priority (ALF-117)', () => {
    // The Folder view ranks its ROOTS by priority but a subtask group follows sort_order — a
    // high-priority subtask does NOT float above a low-priority sibling that sorts earlier.
    const nested: Item[] = [
      item({ id: 'parent', folder_id: 'work' }),
      item({
        id: 'c-low',
        folder_id: 'work',
        parent_id: 'parent',
        priority: 'low',
        sort_order: 10,
      }),
      item({
        id: 'c-high',
        folder_id: 'work',
        parent_id: 'parent',
        priority: 'high',
        sort_order: 20,
      }),
    ];
    const { result } = renderHook(() => useScopedTasks({ type: 'folder', folderId: 'work' }), {
      wrapper: makeWrapper(nested),
    });
    // sort_order asc (c-low=10 before c-high=20) — priority is a display signal only.
    expect(result.current[0]?.children.map((c) => c.id)).toStrictEqual(['c-low', 'c-high']);
  });

  it('inbox keeps capture-first order — priority does not reorder the inbox', () => {
    const inbox: Item[] = [
      item({ id: 'old-high', created_at: '2025-01-01T00:00:00Z', priority: 'high' }),
      item({ id: 'new-low', created_at: '2025-02-01T00:00:00Z', priority: 'low' }),
    ];
    const { result } = renderHook(() => useScopedTasks({ type: 'inbox' }), {
      wrapper: makeWrapper(inbox),
    });
    // Newest captured first; priority is ignored in the inbox.
    expect(result.current.map((n) => n.id)).toStrictEqual(['new-low', 'old-high']);
  });

  it('completed = items with completed status, regardless of folder', () => {
    const { result } = renderScope({ type: 'completed' });
    const ids = result.current.map((n) => n.id);
    expect(ids).toContain('inbox-done');
    expect(ids).toContain('work-done');
  });

  it('keeps completed children nested under an active parent in the inbox view', () => {
    // A completed child stays in the active-view tree (so its parent can reveal it behind
    // "Show completed"); only completed ROOTS are dropped.
    const nested: Item[] = [
      item({ id: 'parent-active' }),
      item({ id: 'child-done', parent_id: 'parent-active', status: 'completed' }),
    ];
    const { result } = renderHook(() => useScopedTasks({ type: 'inbox' }), {
      wrapper: makeWrapper(nested),
    });
    expect(result.current.map((n) => n.id)).toStrictEqual(['parent-active']);
    expect(result.current[0]?.children.map((c) => c.id)).toStrictEqual(['child-done']);
  });

  it('drops a completed root (and its subtree) from the inbox view', () => {
    const nested: Item[] = [
      item({ id: 'root-done', status: 'completed' }),
      item({ id: 'child-done', parent_id: 'root-done', status: 'completed' }),
    ];
    const { result } = renderHook(() => useScopedTasks({ type: 'inbox' }), {
      wrapper: makeWrapper(nested),
    });
    expect(result.current).toStrictEqual([]);
  });

  // An item can carry a folder and still be waiting for triage. It belongs to the Inbox until a
  // human dispatches it, and its subtree has to travel with it — a subtree split across two
  // views loses the orphaned half, because each view filters flat before building its tree.
  describe('an undispatched item that already carries a folder', () => {
    const undispatched: Item[] = [
      item({ id: 'guessed', folder_id: 'work', dispatched_at: null }),
      item({ id: 'guessed-child', folder_id: 'work', parent_id: 'guessed', dispatched_at: null }),
      item({ id: 'filed', folder_id: 'work' }),
    ];

    it('renders in the Inbox, with its subtree', () => {
      const { result } = renderHook(() => useScopedTasks({ type: 'inbox' }), {
        wrapper: makeWrapper(undispatched),
      });
      expect(result.current.map((n) => n.id)).toStrictEqual(['guessed']);
      expect(result.current[0]?.children.map((c) => c.id)).toStrictEqual(['guessed-child']);
    });

    it('is absent from the view of the folder it points at', () => {
      const { result } = renderHook(() => useScopedTasks({ type: 'folder', folderId: 'work' }), {
        wrapper: makeWrapper(undispatched),
      });
      expect(result.current.map((n) => n.id)).toStrictEqual(['filed']);
    });
  });
});

// ---------------------------------------------------------------------------
// Context wiring
// ---------------------------------------------------------------------------

describe('context wiring', () => {
  it('keeps action identity stable across state changes (split contexts)', async () => {
    mockCreateItem.mockResolvedValue(item({ id: 'server-1' }));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });
    const before = result.current.actions;

    await act(async () => {
      await result.current.actions.addTask({ text: 'x' });
    });

    expect(result.current.actions).toBe(before);
  });

  it('throws when useTasks is used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(useTasks)).toThrow(/must be used within a TasksProvider/);
    spy.mockRestore();
  });

  it('throws when useTaskActions is used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(useTaskActions)).toThrow(/must be used within a TasksProvider/);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// useFolderBadgeCounts (per-folder attention/overdue selector — ALF-84)
// ---------------------------------------------------------------------------

/** A local YYYY-MM-DD due-date string offset from today (0 = today, -1 = yesterday, 1 = tomorrow). */
function dueYMD(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('useFolderBadgeCounts', () => {
  it('buckets overdue (red) and due-today (attention/amber) tasks by folder_id', () => {
    const items = [
      item({ id: 'a', folder_id: 'f1', due_date: dueYMD(0) }), // today → attention
      item({ id: 'b', folder_id: 'f1', due_date: dueYMD(-2) }), // past → overdue
      item({ id: 'c', folder_id: 'f2', due_date: dueYMD(-1) }), // past, other folder → overdue
    ];
    const { result } = renderHook(useFolderBadgeCounts, { wrapper: makeWrapper(items) });

    expect(result.current).toEqual({
      f1: { attention: 1, overdue: 1 },
      f2: { attention: 0, overdue: 1 },
    });
  });

  it('counts an active high-priority task as attention regardless of due date', () => {
    const items = [
      item({ id: 'noDue', folder_id: 'f1', priority: 'high', due_date: null }),
      item({ id: 'future', folder_id: 'f1', priority: 'high', due_date: dueYMD(5) }),
    ];
    const { result } = renderHook(useFolderBadgeCounts, { wrapper: makeWrapper(items) });

    expect(result.current['f1']).toEqual({ attention: 2, overdue: 0 });
  });

  it('counts a non-priority task due today as attention', () => {
    const { result } = renderHook(useFolderBadgeCounts, {
      wrapper: makeWrapper([
        item({ id: 'a', folder_id: 'f1', priority: null, due_date: dueYMD(0) }),
      ]),
    });

    expect(result.current['f1']).toEqual({ attention: 1, overdue: 0 });
  });

  it('counts a high-priority OVERDUE task as overdue only (disjoint: red takes precedence)', () => {
    const { result } = renderHook(useFolderBadgeCounts, {
      wrapper: makeWrapper([
        item({ id: 'a', folder_id: 'f1', priority: 'high', due_date: dueYMD(-1) }),
      ]),
    });

    // Not double-counted: overdue wins, attention stays 0.
    expect(result.current['f1']).toEqual({ attention: 0, overdue: 1 });
  });

  it('counts a task due exactly today as attention (boundary: today is not overdue)', () => {
    const { result } = renderHook(useFolderBadgeCounts, {
      wrapper: makeWrapper([item({ id: 'a', folder_id: 'f1', due_date: dueYMD(0) })]),
    });

    expect(result.current['f1']).toEqual({ attention: 1, overdue: 0 });
  });

  it('counts nested subtasks toward their folder (flat folder_id match)', () => {
    // A subtask shares its ancestor's folder bucket; the flat count includes it.
    const items = [
      item({ id: 'parent', folder_id: 'f1', due_date: dueYMD(-1) }), // overdue
      item({ id: 'child', folder_id: 'f1', parent_id: 'parent', due_date: dueYMD(0) }), // today
    ];
    const { result } = renderHook(useFolderBadgeCounts, { wrapper: makeWrapper(items) });

    expect(result.current['f1']).toEqual({ attention: 1, overdue: 1 });
  });

  it('excludes completed, future-due low-priority, due-date-less non-priority, and inbox items', () => {
    const items = [
      item({ id: 'done', folder_id: 'f1', due_date: dueYMD(-1), status: 'completed' }),
      item({ id: 'future', folder_id: 'f1', priority: 'low', due_date: dueYMD(1) }),
      item({ id: 'noDue', folder_id: 'f1', priority: null, due_date: null }),
      item({ id: 'inbox', folder_id: null, due_date: dueYMD(-1) }),
      item({ id: 'inboxHigh', folder_id: null, priority: 'high', due_date: null }),
    ];
    const { result } = renderHook(useFolderBadgeCounts, { wrapper: makeWrapper(items) });

    // None of these qualify, so f1 has no entry and the inbox never appears.
    expect(result.current['f1']).toBeUndefined();
    expect(result.current).toEqual({});
  });

  it('updates as the store changes (optimistic) — completing an overdue task drops its count', async () => {
    const items = [
      item({ id: 'a', folder_id: 'f1', due_date: dueYMD(-1) }), // overdue
      item({ id: 'b', folder_id: 'f1', due_date: dueYMD(0) }), // today
    ];
    mockCompleteTask.mockResolvedValue({
      completed: [{ ...item({ id: 'a' }), status: 'completed' }],
      spawned: null,
    });
    const { result } = renderHook(
      () => ({ counts: useFolderBadgeCounts(), actions: useTaskActions() }),
      { wrapper: makeWrapper(items) },
    );

    expect(result.current.counts['f1']).toEqual({ attention: 1, overdue: 1 });

    await act(async () => {
      await result.current.actions.completeTask('a');
    });

    expect(result.current.counts['f1']).toEqual({ attention: 1, overdue: 0 });
  });

  it('ignores an undispatched item, even one already carrying that folder', () => {
    // The tally counts residency, not location — otherwise an item sitting in the Inbox would
    // inflate the badge of a folder it has not been filed into.
    const items = [
      item({ id: 'guessed', folder_id: 'f1', due_date: dueYMD(-1), dispatched_at: null }),
      item({ id: 'filed', folder_id: 'f1', due_date: dueYMD(0) }),
    ];
    const { result } = renderHook(useFolderBadgeCounts, { wrapper: makeWrapper(items) });

    expect(result.current).toEqual({ f1: { attention: 1, overdue: 0 } });
  });
});

// ---------------------------------------------------------------------------
// Error toasts (ALF-33) — a failed write surfaces a human-readable toast, still
// rolls the optimistic change back, and still re-throws to the caller.
// ---------------------------------------------------------------------------

describe('error toasts', () => {
  const NETWORK = new Error('API PATCH /api/items/x failed: 500 internal');

  it('addTask toasts "Couldn\'t add task" and re-throws on failure', async () => {
    mockCreateItem.mockRejectedValue(NETWORK);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });
    let caught: unknown;

    await act(async () => {
      try {
        await result.current.actions.addTask({ text: 'Buy milk' });
      } catch (error) {
        caught = error;
      }
    });

    expect(mockShowToast).toHaveBeenCalledWith("Couldn't add task");
    // Still rolls back (no leftover optimistic row) and re-throws the original error.
    expect(result.current.tasks).toStrictEqual([]);
    expect(caught).toBe(NETWORK);
  });

  it('completeTask toasts "Couldn\'t complete task" on failure', async () => {
    mockCompleteTask.mockRejectedValue(NETWORK);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([item({ id: 'a' })]) });

    await act(async () => {
      await result.current.actions.completeTask('a').catch(() => {});
    });

    expect(mockShowToast).toHaveBeenCalledWith("Couldn't complete task");
    expect(result.current.tasks[0]?.status).toBe('active');
  });

  it('uncompleteTask toasts "Couldn\'t reopen task" on failure', async () => {
    mockUpdateItem.mockRejectedValue(NETWORK);
    const completed = item({ id: 'a', status: 'completed', completed_at: '2025-01-02T00:00:00Z' });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([completed]) });

    await act(async () => {
      await result.current.actions.uncompleteTask('a').catch(() => {});
    });

    expect(mockShowToast).toHaveBeenCalledWith("Couldn't reopen task");
    expect(result.current.tasks[0]?.status).toBe('completed');
  });

  it('updateTask toasts "Couldn\'t save changes" on failure', async () => {
    mockUpdateItem.mockRejectedValue(NETWORK);
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'a', title: 'Old' })]),
    });

    await act(async () => {
      await result.current.actions.updateTask('a', { title: 'New' }).catch(() => {});
    });

    expect(mockShowToast).toHaveBeenCalledWith("Couldn't save changes");
    // The optimistic title reverts.
    expect(result.current.tasks[0]?.title).toBe('Old');
  });

  it('classifyItem toasts "Couldn\'t update item" on failure', async () => {
    mockUpdateItem.mockRejectedValue(NETWORK);
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'a', item_type: 'unclassified' })]),
    });

    await act(async () => {
      await result.current.actions.classifyItem('a', 'task').catch(() => {});
    });

    expect(mockShowToast).toHaveBeenCalledWith("Couldn't update item");
    expect(result.current.tasks[0]?.item_type).toBe('unclassified');
  });

  it('moveTask toasts "Couldn\'t move task" on failure', async () => {
    mockUpdateItem.mockRejectedValue(NETWORK);
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([item({ id: 'a', folder_id: null })]),
    });

    await act(async () => {
      await result.current.actions.moveTask('a', 'folder-1').catch(() => {});
    });

    expect(mockShowToast).toHaveBeenCalledWith("Couldn't move task");
    expect(result.current.tasks[0]?.folder_id).toBeNull();
  });

  it('reparentTask toasts "Couldn\'t move task" when nesting fails', async () => {
    mockUpdateItem.mockRejectedValue(NETWORK);
    const dragged = item({ id: 'd1', folder_id: null });
    const target = item({ id: 'p1', folder_id: 'folder-9' });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([dragged, target]) });

    await act(async () => {
      await result.current.actions.reparentTask('d1', 'p1').catch(() => {});
    });

    expect(mockShowToast).toHaveBeenCalledWith("Couldn't move task");
    expect(result.current.tasks.find((t) => t.id === 'd1')?.parent_id).toBeNull();
  });

  it('reparentTask toasts "Couldn\'t move task" when promoting to top-level fails', async () => {
    mockUpdateItem.mockRejectedValue(NETWORK);
    const parent = item({ id: 'p1' });
    const child = item({ id: 'd1', parent_id: 'p1' });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    await act(async () => {
      await result.current.actions.reparentTask('d1', null).catch(() => {});
    });

    expect(mockShowToast).toHaveBeenCalledWith("Couldn't move task");
    expect(result.current.tasks.find((t) => t.id === 'd1')?.parent_id).toBe('p1');
  });

  it('deleteTask toasts "Couldn\'t delete task" on failure', async () => {
    mockDeleteItem.mockRejectedValue(NETWORK);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([item({ id: 'a' })]) });

    await act(async () => {
      await result.current.actions.deleteTask('a').catch(() => {});
    });

    expect(mockShowToast).toHaveBeenCalledWith("Couldn't delete task");
    // The optimistically-removed row is restored.
    expect(result.current.tasks.map((t) => t.id)).toStrictEqual(['a']);
  });

  it('removeGatedItem fires NO toast (it makes no API call)', () => {
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([item({ id: 'a' })]) });

    act(() => {
      result.current.actions.removeGatedItem('a');
    });

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(result.current.tasks).toStrictEqual([]);
  });
});
