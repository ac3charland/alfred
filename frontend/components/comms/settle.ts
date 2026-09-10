/**
 * Await a store write whose failure is ALREADY handled — the optimistic action rolled the row
 * back and toasted before re-throwing, so the rejection has nothing left to say at the call
 * site. Without this the re-throw becomes an unhandled rejection in the browser (and a failing
 * test whenever a rollback path is exercised through the UI).
 *
 * Call it as `void settle(action(...))` from an event handler: the handler stays synchronous,
 * the write still runs, and the promise is accounted for.
 */
export async function settle(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // Deliberately swallowed. The store's `onError` has already surfaced this to the owner and
    // restored the row; anything more here would be a second message for one failure.
  }
}
