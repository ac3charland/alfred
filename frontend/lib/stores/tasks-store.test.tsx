import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import type { Item } from '@/lib/types';

import {
  type TaskScope,
  TasksProvider,
  tasksReducer,
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
});

// ---------------------------------------------------------------------------
// completeTask (cascades to the subtree)
// ---------------------------------------------------------------------------

describe('completeTask', () => {
  const parent = item({ id: 'item-1' });
  const child = item({ id: 'c-1', parent_id: 'item-1' });

  it('marks the task and its subtree completed, then reconciles', async () => {
    mockCompleteTask.mockResolvedValue([
      { ...parent, status: 'completed' },
      { ...child, status: 'completed' },
    ]);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([parent, child]) });

    await act(async () => {
      await result.current.actions.completeTask('item-1');
    });

    expect(result.current.tasks.every((t) => t.status === 'completed')).toBe(true);
    expect(mockCompleteTask).toHaveBeenCalledWith('item-1');
  });

  it('marks the subtree completed optimistically before the request resolves', () => {
    mockCompleteTask.mockReturnValue(new Promise<Item[]>(() => {}));
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
