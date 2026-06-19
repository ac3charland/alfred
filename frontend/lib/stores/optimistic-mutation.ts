/**
 * The optimistic-mutation dance every store action repeats (see the data-flow skill):
 * apply the optimistic change synchronously, await the API call, then reconcile with the
 * server response — or roll back and re-throw on failure.
 *
 * The caller supplies the four steps as closures, having already captured whatever it needs
 * for `rollback` (the prior row, the touched fields, or the removed row + its index — the
 * full-row / selective-field / position-aware strategies). This helper owns only the
 * try/await/catch sequencing, so the optimistic and rollback effects stay each action's own:
 *
 * 1. `optimistic()` — dispatch the optimistic change (runs synchronously, before the await).
 * 2. `await apiCall()` — the `lib/api-client` request.
 * 3. on success, `reconcile(result)` — swap client values for the server-canonical row(s).
 *    Optional: a delete drops its rows on the optimistic step, so there is nothing to
 *    reconcile (omit it).
 * 4. on failure, `rollback()` then re-throw, so the caller can react (keep an editor open,
 *    surface an error). A throw from `reconcile` is NOT rolled back — the write already
 *    succeeded, so its failure is the caller's to surface.
 */
export async function runOptimisticMutation<R>(opts: {
  optimistic: () => void;
  apiCall: () => Promise<R>;
  reconcile?: (result: R) => void;
  rollback: () => void;
}): Promise<R> {
  opts.optimistic();
  let result: R;
  try {
    result = await opts.apiCall();
  } catch (error) {
    opts.rollback();
    throw error;
  }
  opts.reconcile?.(result);
  return result;
}
