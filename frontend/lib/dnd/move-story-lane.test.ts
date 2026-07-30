import {
  type DraggedStory,
  LANE_DROP_PREFIX,
  laneDropId,
  parseLaneDropId,
  resolveLaneDrop,
} from './move-story-lane';

/** The three fields a lane drop reads off the dragged card. */
function dragged(overrides: Partial<DraggedStory> = {}): DraggedStory {
  return { ref: 'ALF-7', factory_state: 'needs_refinement', epic_id: 'e1', ...overrides };
}

describe('laneDropId / parseLaneDropId', () => {
  it('round-trips an epic id and a lane state', () => {
    expect(parseLaneDropId(laneDropId('e1', 'in_development'))).toEqual({
      epicId: 'e1',
      state: 'in_development',
    });
  });

  it('gives every epic its own id for the same lane, so lanes never collide across epics', () => {
    expect(laneDropId('e1', 'done')).not.toBe(laneDropId('e2', 'done'));
  });

  it('parses an epic id containing hyphens (a uuid)', () => {
    const id = laneDropId('3f1c8a12-0b7e-4a55-9d3e-6c2a1b9f77aa', 'ready_for_dev');
    expect(parseLaneDropId(id)).toEqual({
      epicId: '3f1c8a12-0b7e-4a55-9d3e-6c2a1b9f77aa',
      state: 'ready_for_dev',
    });
  });

  it('returns null for a null over id (dropped on nothing)', () => {
    expect(parseLaneDropId(null)).toBeNull();
  });

  it('returns null for an id that is not a lane (e.g. a bare story item id)', () => {
    expect(parseLaneDropId('i1')).toBeNull();
  });

  it('returns null for a lane id carrying a state that has no lane of its own', () => {
    // `blocked`/`abandoned` are card treatments, not columns — no lane can be minted for them.
    expect(parseLaneDropId(`${LANE_DROP_PREFIX}blocked::e1`)).toBeNull();
  });

  it('returns null for a lane id with no epic id after the state', () => {
    expect(parseLaneDropId(`${LANE_DROP_PREFIX}done::`)).toBeNull();
  });
});

describe('resolveLaneDrop', () => {
  it('no-ops when the card was dropped on nothing (over = null)', () => {
    expect(resolveLaneDrop(dragged(), null)).toBeNull();
  });

  it('no-ops when the card was dropped on something that is not a lane', () => {
    expect(resolveLaneDrop(dragged(), 'i2')).toBeNull();
  });

  it('moves the story to the lane it was dropped on', () => {
    expect(resolveLaneDrop(dragged(), laneDropId('e1', 'in_development'))).toEqual({
      ref: 'ALF-7',
      state: 'in_development',
      clearsBlockedReason: false,
    });
  });

  it('no-ops when the card is dropped back on the lane it already sits in', () => {
    expect(resolveLaneDrop(dragged(), laneDropId('e1', 'needs_refinement'))).toBeNull();
  });

  it('no-ops on a lane belonging to a DIFFERENT epic (the gesture never re-homes a story)', () => {
    expect(resolveLaneDrop(dragged(), laneDropId('e2', 'in_development'))).toBeNull();
  });

  it('no-ops on another epic even when that lane repeats the story own state', () => {
    // Guards the epic check on its own: the state check alone would already reject this drop.
    expect(resolveLaneDrop(dragged(), laneDropId('e2', 'needs_refinement'))).toBeNull();
  });

  it('no-ops for a story with no ref yet (an optimistic card the server has not reconciled)', () => {
    expect(resolveLaneDrop(dragged({ ref: null }), laneDropId('e1', 'done'))).toBeNull();
  });

  it('no-ops for a story with no epic (the view row is nominally nullable)', () => {
    expect(resolveLaneDrop(dragged({ epic_id: null }), laneDropId('e1', 'done'))).toBeNull();
  });

  it('unblocks a blocked story into the lane it is dropped on, clearing its reason', () => {
    expect(
      resolveLaneDrop(dragged({ factory_state: 'blocked' }), laneDropId('e1', 'in_development')),
    ).toEqual({ ref: 'ALF-7', state: 'in_development', clearsBlockedReason: true });
  });

  it('unblocks a blocked story dropped back on the lane it was blocked from', () => {
    // A blocked card SITS in its origin lane, so this drop looks like a no-op on screen — but
    // `blocked` is not that lane's state, so it is a real unblock rather than nothing at all.
    expect(
      resolveLaneDrop(dragged({ factory_state: 'blocked' }), laneDropId('e1', 'needs_refinement')),
    ).toEqual({ ref: 'ALF-7', state: 'needs_refinement', clearsBlockedReason: true });
  });

  it('moves a story whose state the view left null', () => {
    expect(resolveLaneDrop(dragged({ factory_state: null }), laneDropId('e1', 'done'))).toEqual({
      ref: 'ALF-7',
      state: 'done',
      clearsBlockedReason: false,
    });
  });
});
