import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
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
  parent_id: null,
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
};

function item(overrides: Partial<Item>): Item {
  return { ...BASE, ...overrides };
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

  it('rolls back the optimistic item when creation fails', async () => {
    mockCreateItem.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'oops' }).catch(() => {});
    });

    expect(result.current.tasks).toStrictEqual([]);
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

  it('optimistic subtask row has item_type task before the server responds', () => {
    mockCreateItem.mockReturnValue(new Promise<Item>(() => {}));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    act(() => {
      void result.current.actions.addTask({ text: 'Subtask', parentId: 'parent-1' });
    });

    expect(result.current.tasks[0]?.item_type).toBe('task');
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
    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { folder_id: 'folder-2' });
    expect(mockUpdateItem).toHaveBeenCalledWith('c-1', { folder_id: 'folder-2' });
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
    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { folder_id: 'folder-2' });
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
    expect(mockUpdateItem).toHaveBeenCalledWith('c1', { folder_id: 'folder-2' });
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
    expect(mockUpdateItem).toHaveBeenCalledWith('d1', { parent_id: 'p1', folder_id: 'folder-9' });
    // The subtree adopts the new parent's folder.
    expect(mockUpdateItem).toHaveBeenCalledWith('d1-c', { folder_id: 'folder-9' });
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

    expect(mockUpdateItem).toHaveBeenCalledWith('d1', { parent_id: 'p1', folder_id: 'folder-1' });
    // Same folder → the child is not PATCHed.
    expect(mockUpdateItem).not.toHaveBeenCalledWith('d1-c', { folder_id: 'folder-1' });
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

  it('folder ranks subtasks by priority too (all levels)', () => {
    const nested: Item[] = [
      item({ id: 'parent', folder_id: 'work' }),
      item({ id: 'c-low', folder_id: 'work', parent_id: 'parent', priority: 'low' }),
      item({ id: 'c-high', folder_id: 'work', parent_id: 'parent', priority: 'high' }),
    ];
    const { result } = renderHook(() => useScopedTasks({ type: 'folder', folderId: 'work' }), {
      wrapper: makeWrapper(nested),
    });
    expect(result.current[0]?.children.map((c) => c.id)).toStrictEqual(['c-high', 'c-low']);
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
