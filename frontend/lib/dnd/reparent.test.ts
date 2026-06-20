import { resolveReparent } from './reparent';

describe('resolveReparent', () => {
  it('no-ops when the task was dropped on nothing (over = null)', () => {
    expect(resolveReparent('t1', null, null, new Set(['t1']))).toBeNull();
  });

  it('no-ops on a null drop even when the task currently has a parent', () => {
    // A non-null currentParentId here makes the `overId === null` guard the *only* thing
    // returning null — without it, the function would emit a re-parent to a null parent.
    expect(resolveReparent('t1', null, 'p1', new Set(['t1']))).toBeNull();
  });

  it('nests an inbox root under another task', () => {
    expect(resolveReparent('t1', 'p1', null, new Set(['t1']))).toEqual({
      itemId: 't1',
      newParentId: 'p1',
    });
  });

  it('re-parents a subtask under a different task', () => {
    expect(resolveReparent('t1', 'p2', 'p1', new Set(['t1']))).toEqual({
      itemId: 't1',
      newParentId: 'p2',
    });
  });

  it('no-ops when dropped onto itself', () => {
    expect(resolveReparent('t1', 't1', null, new Set(['t1']))).toBeNull();
  });

  it('no-ops when dropped onto one of its own descendants (would create a cycle)', () => {
    const subtree = new Set(['t1', 'child', 'grandchild']);
    expect(resolveReparent('t1', 'grandchild', null, subtree)).toBeNull();
  });

  it('no-ops when dropped onto the parent it already has', () => {
    expect(resolveReparent('t1', 'p1', 'p1', new Set(['t1']))).toBeNull();
  });
});
