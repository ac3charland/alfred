import {
  LIST_BOTTOM_DROP_ID,
  LIST_TOP_DROP_ID,
  isPromoteZone,
  resolvePromoteToRoot,
} from './promote-to-root';

describe('isPromoteZone', () => {
  it('is true for the top and bottom zone ids', () => {
    expect(isPromoteZone(LIST_TOP_DROP_ID)).toBe(true);
    expect(isPromoteZone(LIST_BOTTOM_DROP_ID)).toBe(true);
  });

  it('is false for a task id or null', () => {
    expect(isPromoteZone('some-task')).toBe(false);
    expect(isPromoteZone(null)).toBe(false);
  });
});

describe('resolvePromoteToRoot', () => {
  it('promotes a child dropped on the top zone', () => {
    expect(resolvePromoteToRoot('c1', LIST_TOP_DROP_ID, 'p1')).toEqual({ itemId: 'c1' });
  });

  it('promotes a child dropped on the bottom zone', () => {
    expect(resolvePromoteToRoot('c1', LIST_BOTTOM_DROP_ID, 'p1')).toEqual({ itemId: 'c1' });
  });

  it('no-ops when the task is already top-level (no parent)', () => {
    expect(resolvePromoteToRoot('c1', LIST_TOP_DROP_ID, null)).toBeNull();
  });

  it('no-ops when dropped somewhere other than a promote zone', () => {
    expect(resolvePromoteToRoot('c1', 'another-task', 'p1')).toBeNull();
    expect(resolvePromoteToRoot('c1', null, 'p1')).toBeNull();
  });
});
