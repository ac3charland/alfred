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
});

describe('uncompleteTask', () => {
  it('reactivates a completed task and reconciles', async () => {
    const completed = item({ id: 'item-1', status: 'completed' });
    mockUpdateItem.mockResolvedValue({ ...completed, status: 'active' });
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([completed]) });

    await act(async () => {
      await result.current.actions.uncompleteTask('item-1');
    });

    expect(result.current.tasks[0]?.status).toBe('active');
    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { status: 'active' });
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
});

// ---------------------------------------------------------------------------
// useScopedTasks (client-side filtering)
// ---------------------------------------------------------------------------

describe('useScopedTasks', () => {
  const items: Item[] = [
    item({ id: 'inbox-active' }),
    item({ id: 'inbox-done', status: 'completed' }),
    item({ id: 'work-active', folder_id: 'work' }),
    item({ id: 'work-child', folder_id: 'work', parent_id: 'work-active' }),
  ];

  function renderScope(scope: TaskScope) {
    return renderHook(() => useScopedTasks(scope), { wrapper: makeWrapper(items) });
  }

  it('inbox = active, folder-less items', () => {
    const { result } = renderScope({ type: 'inbox' });
    expect(result.current.map((n) => n.id)).toStrictEqual(['inbox-active']);
  });

  it('folder = active items in that folder, nested into a tree', () => {
    const { result } = renderScope({ type: 'folder', folderId: 'work' });
    expect(result.current.map((n) => n.id)).toStrictEqual(['work-active']);
    expect(result.current[0]?.children.map((c) => c.id)).toStrictEqual(['work-child']);
  });

  it('completed = items with completed status, regardless of folder', () => {
    const { result } = renderScope({ type: 'completed' });
    expect(result.current.map((n) => n.id)).toStrictEqual(['inbox-done']);
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

  it('throws when the hooks are used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(useTasks)).toThrow(/must be used within a TasksProvider/);
    spy.mockRestore();
  });
});
