import { spawnSync } from 'node:child_process';

/** Remote-tracking trunk refs, in priority order — what a fresh CI checkout diffs against. */
const REMOTE_TRUNK_REFS: readonly string[] = ['origin/main', 'origin/master'];
/** Local trunk branches — a LAST resort, used only when there is no `origin` remote. */
const LOCAL_TRUNK_REFS: readonly string[] = ['main', 'master'];

/**
 * Run git with the repo's own config neutralized where it would corrupt our reading of the
 * output. `core.quotePath` (on by default) C-escapes non-ASCII paths, which would make a
 * perfectly ordinary `docs/café.md` fail the docs-only test.
 */
function git(args: readonly string[]): { status: number | null; stdout: string } {
  const result = spawnSync('git', ['-c', 'core.quotePath=false', ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout };
}

/**
 * The git facts {@link chooseTrunkRef} needs, gathered up front so the choice itself stays a
 * pure (unit-testable) function rather than shelling out.
 */
export interface TrunkRefFacts {
  /** `origin/<branch>` resolved from `refs/remotes/origin/HEAD`, when that ref is set. */
  readonly originHead: string | undefined;
  /** Remote-tracking trunk refs that exist, in priority order. */
  readonly remote: readonly string[];
  /** Local trunk branches that exist, in priority order. */
  readonly local: readonly string[];
  /** Whether an `origin` remote is configured at all. */
  readonly hasOrigin: boolean;
}

/**
 * Choose the ref to diff against. Prefers the **remote** trunk — the same ref a fresh CI
 * checkout uses — so the gate decides identically locally and in CI.
 *
 * It never falls back to a local trunk while an `origin` remote exists, and that is a safety
 * rule, not a preference: a local `main` carrying commits the remote has not seen pushes the
 * merge-base *forward*, hiding those commits from the changed set. A docs-only branch stacked
 * on an unpushed code commit would then skip the slow tier while the push carries that code to
 * the remote. With an origin present but its trunk ref missing we return `undefined` ("trunk
 * unknown"), which runs the full tier. A local trunk is used only when there is no origin at
 * all (a standalone repo), where there is no remote state to diverge from.
 */
export function chooseTrunkRef(facts: TrunkRefFacts): string | undefined {
  if (facts.originHead !== undefined) return facts.originHead;
  if (facts.remote.length > 0) return facts.remote[0];
  if (facts.hasOrigin) return undefined;
  return facts.local[0];
}

/** True when the git ref resolves to a commit. */
function refExists(ref: string): boolean {
  return git(['rev-parse', '--verify', '--quiet', ref]).status === 0;
}

/** `origin/<branch>` from the remote's default-branch symbolic ref, when set and resolvable. */
function resolveOriginHead(): string | undefined {
  const result = git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (result.status !== 0) return undefined;
  const ref = result.stdout.trim().replace(/^refs\/remotes\//, '');
  return ref.length > 0 && refExists(ref) ? ref : undefined;
}

/** Whether an `origin` remote is configured. */
function hasOriginRemote(): boolean {
  const result = git(['remote']);
  if (result.status !== 0) return false;
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .includes('origin');
}

/** Gather the trunk-ref facts from git for {@link chooseTrunkRef}. */
function gatherTrunkRefFacts(): TrunkRefFacts {
  return {
    originHead: resolveOriginHead(),
    remote: REMOTE_TRUNK_REFS.filter((ref) => refExists(ref)),
    local: LOCAL_TRUNK_REFS.filter((ref) => refExists(ref)),
    hasOrigin: hasOriginRemote(),
  };
}

/**
 * Repo-relative paths changed on the current branch vs the trunk merge-base, or `undefined`
 * when git can't tell us — no git, no usable trunk ref (see {@link chooseTrunkRef}), or any
 * command failing. An `undefined` result is the caller's signal to run the full tier (never
 * skip a gate on a guess).
 *
 * `--no-renames` is load-bearing. With git's default rename detection a move prints **only
 * the destination**, so `git mv frontend/e2e/tasks.spec.ts docs/archive/` — a deleted E2E
 * spec — would read as a docs-only change and skip the very suite it removed. Disabling
 * detection makes a rename what it physically is: a delete plus an add, both sides visible.
 *
 * The diff is taken against **HEAD**, not the working tree: check:slow runs at pre-push, where
 * the content being pushed is already committed, so uncommitted scratch edits must not decide
 * whether the gate runs. (skill-lint diffs the working tree instead because it runs at
 * pre-commit, before the commit exists.)
 */
export function changedPathsSinceTrunk(): readonly string[] | undefined {
  const trunk = chooseTrunkRef(gatherTrunkRefFacts());
  if (trunk === undefined) return undefined;
  const base = git(['merge-base', 'HEAD', trunk]);
  if (base.status !== 0) return undefined;
  const mergeBase = base.stdout.trim();
  if (mergeBase.length === 0) return undefined;
  const diff = git(['diff', '--no-renames', '--name-only', mergeBase, 'HEAD']);
  if (diff.status !== 0) return undefined;
  return diff.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
