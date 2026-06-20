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
  switch (action.type) {
    case 'insert': {
      return [...state, action.item];
    }
    case 'replace': {
      return state.map((row) => (row.id === action.id ? action.item : row));
    }
    case 'patch': {
      const ids = new Set(action.ids);
      return state.map((row) => (ids.has(row.id) ? { ...row, ...action.patch } : row));
    }
    case 'upsert': {
      const byId = new Map(action.items.map((row) => [row.id, row] as const));
      const replaced = state.map((row) => byId.get(row.id) ?? row);
      const presentIds = new Set(state.map((row) => row.id));
      const added = action.items.filter((row) => !presentIds.has(row.id));
      return [...replaced, ...added];
    }
    case 'remove': {
      const ids = new Set(action.ids);
      return state.filter((row) => !ids.has(row.id));
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
