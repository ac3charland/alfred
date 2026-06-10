import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import type { ItemNode } from '@/lib/tree';
import { findNode } from '@/lib/tree';

import { TasksProvider, tasksReducer, useTaskActions, useTasks } from './tasks-store';

jest.mock('@/lib/api-client');
const mockCreateItem = jest.mocked(apiClient.createItem);
const mockCompleteTask = jest.mocked(apiClient.completeTask);
const mockUpdateItem = jest.mocked(apiClient.updateItem);
const mockDeleteItem = jest.mocked(apiClient.deleteItem);
const mockMoveToInbox = jest.mocked(apiClient.moveToInbox);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE: ItemNode = {
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
  children: [],
};

function node(overrides: Partial<ItemNode>): ItemNode {
  return { ...BASE, children: [], ...overrides };
}

function makeWrapper(initialTasks: ItemNode[]) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <TasksProvider initialTasks={initialTasks}>{children}</TasksProvider>;
  };
}

function useTasksTest() {
  return { tasks: useTasks(), actions: useTaskActions() };
}

/** Narrow `T | undefined` to `T` without a cast or non-null assertion (both linted out). */
function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a defined value');
  return value;
}

// ---------------------------------------------------------------------------
// Reducer (pure) — delegates to lib/tree, so we spot-check the wiring
// ---------------------------------------------------------------------------

describe('tasksReducer', () => {
  it('replace keeps the locally-accumulated children (reconcile invariant)', () => {
    const parent = node({ id: 'temp-1', children: [node({ id: 'c-1' })] });
    // The API returns a flat Item (no `children` key) — strip it so the spread can't clobber.
    const { children, ...flatServerRow } = node({ id: 'server-1' });
    const next = tasksReducer([parent], { type: 'replace', id: 'temp-1', item: flatServerRow });
    expect(findNode(next, 'server-1')?.children.map((c) => c.id)).toStrictEqual(['c-1']);
  });

  it('replace and patch are no-ops for an absent id (race rule)', () => {
    const forest = [node({ id: 'item-1' })];
    expect(
      tasksReducer(forest, { type: 'patch', id: 'gone', patch: { notes: 'x' } }),
    ).toStrictEqual(forest);
    expect(
      tasksReducer(forest, { type: 'replace', id: 'gone', item: { ...BASE, id: 'gone' } }),
    ).toStrictEqual(forest);
  });

  it('remove then restore round-trips the forest', () => {
    const forest = [node({ id: 'item-1' }), node({ id: 'item-2' })];
    const removed = defined(forest[0]);
    const afterRemove = tasksReducer(forest, { type: 'remove', id: 'item-1' });
    const restored = tasksReducer(afterRemove, {
      type: 'restore',
      removed,
      parentId: null,
      index: 0,
    });
    expect(restored.map((n) => n.id)).toStrictEqual(['item-1', 'item-2']);
  });
});

// ---------------------------------------------------------------------------
// addTask
// ---------------------------------------------------------------------------

describe('addTask', () => {
  it('inserts an optimistic root immediately, then reconciles to the server row', async () => {
    const saved = node({ id: 'server-1', title: 'Buy milk' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'Buy milk' });
    });

    expect(result.current.tasks.map((t) => t.id)).toStrictEqual(['server-1']);
  });

  it('inserts an optimistic subtask under its parent', async () => {
    const saved = node({ id: 'server-c', parent_id: 'p-1' });
    mockCreateItem.mockResolvedValue(saved);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([node({ id: 'p-1' })]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'sub', parentId: 'p-1' });
    });

    expect(findNode(result.current.tasks, 'p-1')?.children.map((c) => c.id)).toStrictEqual([
      'server-c',
    ]);
  });

  it('rolls back the optimistic task when creation fails', async () => {
    mockCreateItem.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await result.current.actions.addTask({ text: 'oops' }).catch(() => {});
    });

    expect(result.current.tasks).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// completeTask / uncompleteTask
// ---------------------------------------------------------------------------

describe('completeTask', () => {
  it('removes the task immediately and keeps it removed on success', async () => {
    mockCompleteTask.mockResolvedValue([]);
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([node({ id: 'item-1' }), node({ id: 'item-2' })]),
    });

    await act(async () => {
      await result.current.actions.completeTask('item-1');
    });

    expect(result.current.tasks.map((t) => t.id)).toStrictEqual(['item-2']);
    expect(mockCompleteTask).toHaveBeenCalledWith('item-1');
  });

  it('restores the subtree at its position when completion fails', async () => {
    mockCompleteTask.mockRejectedValue(new Error('network'));
    const forest = [
      node({ id: 'item-1', children: [node({ id: 'c-1' })] }),
      node({ id: 'item-2' }),
    ];
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper(forest) });

    await act(async () => {
      await result.current.actions.completeTask('item-1').catch(() => {});
    });

    expect(result.current.tasks.map((t) => t.id)).toStrictEqual(['item-1', 'item-2']);
    expect(findNode(result.current.tasks, 'c-1')).toBeDefined();
  });
});

describe('uncompleteTask', () => {
  it('removes the task from the completed scope and reactivates it', async () => {
    mockUpdateItem.mockResolvedValue(BASE);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([node({ id: 'item-1' })]) });

    await act(async () => {
      await result.current.actions.uncompleteTask('item-1');
    });

    expect(result.current.tasks).toStrictEqual([]);
    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { status: 'active' });
  });
});

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------

describe('updateTask', () => {
  it('patches optimistically and reconciles with the server row', async () => {
    mockUpdateItem.mockResolvedValue(node({ id: 'item-1', notes: 'from server' }));
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([node({ id: 'item-1' })]) });

    await act(async () => {
      await result.current.actions.updateTask('item-1', { notes: 'typed' });
    });

    expect(findNode(result.current.tasks, 'item-1')?.notes).toBe('from server');
  });

  it('rolls back the patched field on failure', async () => {
    mockUpdateItem.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([node({ id: 'item-1', notes: 'original' })]),
    });

    await act(async () => {
      await result.current.actions.updateTask('item-1', { notes: 'typed' }).catch(() => {});
    });

    expect(findNode(result.current.tasks, 'item-1')?.notes).toBe('original');
  });
});

// ---------------------------------------------------------------------------
// moveTask
// ---------------------------------------------------------------------------

describe('moveTask', () => {
  it('removes the subtree from the scope and patches every descendant to the folder', async () => {
    mockUpdateItem.mockResolvedValue(BASE);
    const forest = [node({ id: 'item-1', children: [node({ id: 'c-1' })] })];
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper(forest) });

    await act(async () => {
      await result.current.actions.moveTask('item-1', 'folder-2');
    });

    expect(result.current.tasks).toStrictEqual([]);
    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { folder_id: 'folder-2' });
    expect(mockUpdateItem).toHaveBeenCalledWith('c-1', { folder_id: 'folder-2' });
  });

  it('uses moveToInbox when the target folder is null', async () => {
    mockMoveToInbox.mockResolvedValue(BASE);
    const { result } = renderHook(useTasksTest, { wrapper: makeWrapper([node({ id: 'item-1' })]) });

    await act(async () => {
      await result.current.actions.moveTask('item-1', null);
    });

    expect(mockMoveToInbox).toHaveBeenCalledWith('item-1');
  });

  it('restores the subtree when the move fails', async () => {
    mockUpdateItem.mockRejectedValue(new Error('network'));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([node({ id: 'item-1' })]),
    });

    await act(async () => {
      await result.current.actions.moveTask('item-1', 'folder-2').catch(() => {});
    });

    expect(result.current.tasks.map((t) => t.id)).toStrictEqual(['item-1']);
  });
});

// ---------------------------------------------------------------------------
// deleteTask + wiring
// ---------------------------------------------------------------------------

describe('deleteTask', () => {
  it('removes the task immediately', () => {
    mockDeleteItem.mockReturnValue(new Promise<{ success: true }>(() => {}));
    const { result } = renderHook(useTasksTest, {
      wrapper: makeWrapper([node({ id: 'item-1' }), node({ id: 'item-2' })]),
    });

    act(() => {
      void result.current.actions.deleteTask('item-1');
    });

    expect(result.current.tasks.map((t) => t.id)).toStrictEqual(['item-2']);
  });
});

describe('context wiring', () => {
  it('keeps action identity stable across state changes (split contexts)', async () => {
    mockCreateItem.mockResolvedValue(node({ id: 'server-1' }));
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
