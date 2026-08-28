import { tempId } from '@/lib/tree';
import type { ItemType } from '@/lib/types';

import {
  type DispatchBlocker,
  dispatchReadiness,
  rowDispatchAction,
  summarizeBlockers,
} from './dispatch';

function candidate(
  overrides: Partial<{
    id: string;
    item_type: ItemType;
    folder_id: string | null;
    intended_project_id: string | null;
    intended_epic_id: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? 'real-id',
    item_type: overrides.item_type ?? 'unclassified',
    folder_id: overrides.folder_id ?? null,
    intended_project_id: overrides.intended_project_id ?? null,
    intended_epic_id: overrides.intended_epic_id ?? null,
  };
}

describe('dispatchReadiness', () => {
  // The readiness table, row by row: what each shape needs before Dispatch will send it.
  it('a task with a folder is ready', () => {
    expect(dispatchReadiness(candidate({ item_type: 'task', folder_id: 'f1' }), false)).toEqual({
      ready: true,
    });
  });

  it('a task with subtasks is still ready — the dispatch cascades over its subtree', () => {
    expect(dispatchReadiness(candidate({ item_type: 'task', folder_id: 'f1' }), true)).toEqual({
      ready: true,
    });
  });

  it('a task without a folder needs a folder', () => {
    expect(dispatchReadiness(candidate({ item_type: 'task' }), false)).toEqual({
      ready: false,
      blocker: 'needs a folder',
    });
  });

  it('a code item with both hints and no children is ready', () => {
    expect(
      dispatchReadiness(
        candidate({ item_type: 'code', intended_project_id: 'p1', intended_epic_id: 'e1' }),
        false,
      ),
    ).toEqual({ ready: true });
  });

  it('a code item without a project needs a project (before the epic)', () => {
    expect(dispatchReadiness(candidate({ item_type: 'code' }), false)).toEqual({
      ready: false,
      blocker: 'needs a project',
    });
  });

  it('a code item with a project but no epic needs an epic', () => {
    expect(
      dispatchReadiness(candidate({ item_type: 'code', intended_project_id: 'p1' }), false),
    ).toEqual({ ready: false, blocker: 'needs an epic' });
  });

  it('a code item with children dispatches from its own row menu, whatever its hints', () => {
    // An epic-shaped row goes through convert_to_code_epic, not enter_code_module — full hints
    // don't change that, and the bulk bar has no epic path.
    expect(
      dispatchReadiness(
        candidate({ item_type: 'code', intended_project_id: 'p1', intended_epic_id: 'e1' }),
        true,
      ),
    ).toEqual({ ready: false, blocker: 'dispatch from its own row menu' });
  });

  it('an unclassified row is never ready', () => {
    expect(dispatchReadiness(candidate(), false)).toEqual({
      ready: false,
      blocker: 'needs a type',
    });
  });

  it('a row still carrying a temp id is still saving, whatever else it has', () => {
    expect(
      dispatchReadiness(candidate({ id: tempId(), item_type: 'task', folder_id: 'f1' }), false),
    ).toEqual({ ready: false, blocker: 'still saving' });
  });
});

describe('summarizeBlockers', () => {
  it('is null for an all-ready selection', () => {
    expect(summarizeBlockers([])).toBeNull();
  });

  it('groups blockers by reason with counts', () => {
    expect(summarizeBlockers(['needs a folder', 'needs an epic'])).toBe(
      '2 not ready — 1 needs a folder, 1 needs an epic',
    );
  });

  it('pluralises the verb when a reason repeats', () => {
    expect(summarizeBlockers(['needs a folder', 'needs a folder', 'needs a type'])).toBe(
      '3 not ready — 1 needs a type, 2 need a folder',
    );
  });

  it('keeps a stable reason order regardless of selection order', () => {
    const blockers: DispatchBlocker[] = ['still saving', 'needs an epic', 'needs a type'];
    expect(summarizeBlockers(blockers)).toBe(
      '3 not ready — 1 needs a type, 1 needs an epic, 1 still saving',
    );
  });

  it('reads naturally for the row-menu and still-saving reasons', () => {
    expect(summarizeBlockers(['dispatch from its own row menu'])).toBe(
      '1 not ready — 1 dispatch from its own row menu',
    );
    expect(summarizeBlockers(['still saving', 'still saving'])).toBe(
      '2 not ready — 2 still saving',
    );
  });
});

describe('rowDispatchAction', () => {
  // The row's Dispatch covers one shape the bulk bar can't: an epic-shaped code row, which
  // travels through convert_to_code_epic. Everything else defers to dispatchReadiness, so the
  // two surfaces can never disagree about what "ready" means.
  it('sends a ready task', () => {
    expect(
      rowDispatchAction(candidate({ item_type: 'task', folder_id: 'f1' }), {
        hasChildren: false,
        groupHasTempIds: false,
      }),
    ).toEqual({ kind: 'send' });
  });

  it('sends a ready childless code row', () => {
    expect(
      rowDispatchAction(
        candidate({ item_type: 'code', intended_project_id: 'p1', intended_epic_id: 'e1' }),
        { hasChildren: false, groupHasTempIds: false },
      ),
    ).toEqual({ kind: 'send' });
  });

  it('converts a code parent, opening the project dialog when no project is set', () => {
    expect(
      rowDispatchAction(candidate({ item_type: 'code' }), {
        hasChildren: true,
        groupHasTempIds: false,
      }),
    ).toEqual({ kind: 'epic', opensDialog: true });
  });

  it('converts a code parent straight away when an intended project is set', () => {
    // No epic hint needed: the conversion CREATES the epic from the parent.
    expect(
      rowDispatchAction(candidate({ item_type: 'code', intended_project_id: 'p1' }), {
        hasChildren: true,
        groupHasTempIds: false,
      }),
    ).toEqual({ kind: 'epic', opensDialog: false });
  });

  it('blocks a code parent while any row in the group is still saving', () => {
    // The conversion RPC needs real ids for the parent AND its children.
    expect(
      rowDispatchAction(candidate({ item_type: 'code', intended_project_id: 'p1' }), {
        hasChildren: true,
        groupHasTempIds: true,
      }),
    ).toEqual({ kind: 'blocked', blocker: 'still saving' });
  });

  it('blocks an unready row with the blocker readiness names', () => {
    expect(
      rowDispatchAction(candidate({ item_type: 'task' }), {
        hasChildren: false,
        groupHasTempIds: false,
      }),
    ).toEqual({ kind: 'blocked', blocker: 'needs a folder' });
    expect(rowDispatchAction(candidate(), { hasChildren: false, groupHasTempIds: false })).toEqual({
      kind: 'blocked',
      blocker: 'needs a type',
    });
  });

  it('blocks a code parent whose own id is still a temp id', () => {
    expect(
      rowDispatchAction(candidate({ id: tempId(), item_type: 'code', intended_project_id: 'p1' }), {
        hasChildren: true,
        groupHasTempIds: false,
      }),
    ).toEqual({ kind: 'blocked', blocker: 'still saving' });
  });

  it('blocks a row still carrying its own temp id', () => {
    expect(
      rowDispatchAction(candidate({ id: tempId(), item_type: 'task', folder_id: 'f1' }), {
        hasChildren: false,
        groupHasTempIds: false,
      }),
    ).toEqual({ kind: 'blocked', blocker: 'still saving' });
  });
});
