/**
 * Await a store write whose failure the write has ALREADY handled — the optimistic action rolled
 * the row back and toasted before re-throwing, so the rejection has nothing left to say at the
 * call site. Without this, the re-throw becomes an unhandled promise rejection in the browser
 * (and a failing test) whenever a click fires a rollback path.
 *
 * Call it as `void settle(action(...))` from an event handler: the handler stays synchronous,
 * the write still runs, and the promise is accounted for.
 *
 * This is a copy of comms' own `settle` helper (`components/comms/settle.ts`), not an import from
 * it. The frontend-architecture skill routes a reusable behaviour helper to `lib/hooks/` or
 * `lib/` (its placement table), and lists "a helper defined identically in two files" as a named
 * anti-pattern — so the honest fix is consolidating both callers onto one `lib/` helper, which
 * this story deliberately doesn't do: it would mean editing comms' own files, and the epic caps
 * how much of comms this story touches. Consolidating `settle` (and the settings-card strings in
 * `publications.styles.ts`) onto shared `lib/` / `components/atoms/` helpers, alongside comms'
 * own `AccountDot` → `StatusDot` consolidation, is the named follow-up.
 */
export async function settle(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // Deliberately swallowed — the store already surfaced a toast and restored the row.
  }
}
