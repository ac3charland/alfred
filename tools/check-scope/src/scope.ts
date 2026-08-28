/**
 * The decision: whether the wrapped command runs, and the one-line explanation the CLI
 * prints. Keeping it a value (rather than a bare boolean) means every skip is accounted
 * for in the push output — a gate that goes quiet without saying why is a gate nobody
 * trusts.
 */
export interface ScopeDecision {
  /** True to run the wrapped command; false to skip it. */
  readonly run: boolean;
  /** Why, phrased to follow "check-scope: " in the CLI's output. */
  readonly reason: string;
}

/**
 * A path counts as docs iff it is `docs` itself or sits under `docs/`. Deliberately
 * identical to demo-lint's rule, so "docs-only branch" means exactly one thing across
 * both check:slow gates. Paths are repo-relative and POSIX (what `git diff --name-only`
 * emits), so a package's own nested `docs/` folder is NOT docs by this definition.
 */
export function isDocsPath(p: string): boolean {
  return p === 'docs' || p.startsWith('docs/');
}

/**
 * Decide whether the slow tier needs to run for this branch's changes.
 *
 * A branch whose every change lives under `docs/` — a refinement spec, a demo doc, a
 * lint suggestion — cannot break a Storybook snapshot, a Playwright flow, or the
 * database integration suite, so those minutes buy nothing. Everything else runs the
 * full tier.
 *
 * **Every uncertain case runs.** An unknown diff (`undefined` — no git, no trunk ref, a
 * failed command) and an empty one (trunk itself, or a checkout we can't read) both fall
 * through to running, because the cost of a needless slow run is minutes and the cost of
 * a wrongly-skipped gate is a broken main.
 */
export function decideScope(changedPaths?: readonly string[], forceAll = false): ScopeDecision {
  if (forceAll) {
    return { run: true, reason: 'CHECK_SCOPE_ALL is set — running the full tier.' };
  }
  if (changedPaths === undefined) {
    return { run: true, reason: 'the diff vs trunk is unknown — running the full tier.' };
  }
  if (changedPaths.length === 0) {
    return { run: true, reason: 'nothing changed vs trunk — running the full tier.' };
  }
  const outsideDocs = changedPaths.filter((p) => !isDocsPath(p));
  if (outsideDocs.length === 0) {
    return {
      run: false,
      reason: `every change on this branch is under docs/ (${String(changedPaths.length)} file(s)) — skipping.`,
    };
  }
  return {
    run: true,
    reason: `${String(outsideDocs.length)} change(s) outside docs/ (e.g. ${String(outsideDocs[0])}) — running the full tier.`,
  };
}
