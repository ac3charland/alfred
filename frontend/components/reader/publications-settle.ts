/**
 * Await a store write whose failure the write has ALREADY handled — the optimistic action rolled
 * the row back and toasted before re-throwing, so the rejection has nothing left to say at the
 * call site. Without this, the re-throw becomes an unhandled promise rejection in the browser
 * (and a failing test) whenever a click fires a rollback path.
 *
 * Call it as `void settle(action(...))` from an event handler: the handler stays synchronous,
 * the write still runs, and the promise is accounted for.
 *
 * A small copy of comms' own `settle` helper (`components/comms/settle.ts`) rather than an
 * import from it: `components/comms/` is off limits to this module (CLAUDE.md), and the
 * frontend-architecture skill's shared layer lives in `components/atoms/`, not in another
 * feature module's own directory.
 */
export async function settle(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // Deliberately swallowed — the store already surfaced a toast and restored the row.
  }
}
