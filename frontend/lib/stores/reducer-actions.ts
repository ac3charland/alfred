import { assertNever } from '@/lib/stores/assert-never';

/**
 * The five generic moves a flat-array optimistic store reducer needs, over any row type
 * keyed by a string `id`. This is the shape `tasks-store` dispatches; `simpleReducer`
 * implements it once so a store is just `simpleReducer<Row>(state, action, '<row> action')`.
 *
 * - `insert` appends a row.
 * - `replace` swaps a single row by id (temp → server); a no-op when the id is absent.
 * - `patch` shallow-merges `patch` into every row in `ids` (single edit or cascade); the
 *   race rule falls out for free — ids no longer present are skipped.
 * - `upsert` replaces present rows by id and appends any missing ones: it serves both
 *   reconcile-many (server rows) and rollback (re-apply the captured originals).
 * - `remove` drops every row in `ids`.
 */
export type SimpleAction<T> =
  | { type: 'insert'; item: T }
  | { type: 'replace'; id: string; item: T }
  | { type: 'patch'; ids: string[]; patch: Partial<T> }
  | { type: 'upsert'; items: T[] }
  | { type: 'remove'; ids: string[] };

/**
 * Pure reducer over a flat list of `{ id }` rows. `context` names the store for the
 * exhaustiveness throw (e.g. `'task action'` → `Unhandled task action: …`).
 */
export function simpleReducer<T extends { id: string }>(
  state: T[],
  action: SimpleAction<T>,
  context: string,
): T[] {
  return keyedReducer(state, action, context, (row) => row.id);
}

/**
 * The same five moves over a list whose identity is NOT a column called `id` — `keyOf` says what
 * a row is keyed on, and the action's `id` / `ids` carry that key.
 *
 * Most rows in the app are database rows and are keyed on their primary key, which is why
 * {@link simpleReducer} (this with `row.id`) is what stores reach for. A row read from an
 * aggregate view has no primary key at all: the Reader's candidate senders are grouped by
 * handle, and the handle IS the identity — so the choice is either this, or inventing an `id`
 * column that nothing in the database has.
 */
export function keyedReducer<T>(
  state: T[],
  action: SimpleAction<T>,
  context: string,
  keyOf: (row: T) => string,
): T[] {
  switch (action.type) {
    case 'insert': {
      return [...state, action.item];
    }
    case 'replace': {
      return state.map((row) => (keyOf(row) === action.id ? action.item : row));
    }
    case 'patch': {
      const ids = new Set(action.ids);
      return state.map((row) => (ids.has(keyOf(row)) ? { ...row, ...action.patch } : row));
    }
    case 'upsert': {
      const byId = new Map(action.items.map((row) => [keyOf(row), row] as const));
      const replaced = state.map((row) => byId.get(keyOf(row)) ?? row);
      const presentIds = new Set(state.map((row) => keyOf(row)));
      const added = action.items.filter((row) => !presentIds.has(keyOf(row)));
      return [...replaced, ...added];
    }
    case 'remove': {
      const ids = new Set(action.ids);
      return state.filter((row) => !ids.has(keyOf(row)));
    }
    default: {
      return assertNever(action, context);
    }
  }
}

/**
 * Insert `item` at `index`, clamped to `[0, list.length]`. The position-aware building
 * block for an ordered rollback (folders restore a removed row at its original slot).
 */
export function insertAt<T>(list: T[], item: T, index: number): T[] {
  const at = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, at), item, ...list.slice(at)];
}

/**
 * The values `row` currently holds for exactly the fields `patch` names — the capture half of a
 * SELECTIVE-FIELD rollback (see the data-flow skill's three rollback strategies). Restoring only
 * what a write touched is what keeps a stale failure from clobbering an unrelated change that
 * landed on the row meanwhile, which matters most where a second writer pushes into the store.
 */
export function capturedFields<T extends object>(row: T, patch: Partial<T>): Partial<T> {
  const captured: Partial<T> = {};
  for (const key of Object.keys(patch)) {
    Object.assign(captured, { [key]: row[key as keyof T] });
  }
  return captured;
}
