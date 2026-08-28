import { spawnSync } from 'node:child_process';

/** Trunk refs to diff against, in priority order (first existing one wins). */
const TRUNK_REFS: readonly string[] = ['origin/main', 'main', 'origin/master', 'master'];

/**
 * Repo-relative paths changed on the current branch vs the trunk merge-base, or `undefined`
 * when git can't tell us — no git, no trunk ref among {@link TRUNK_REFS} (e.g. a shallow CI
 * checkout), or any command failing. An `undefined` result is the caller's signal to run the
 * full tier (never skip a gate on a guess).
 *
 * The diff is taken against **HEAD**, not the working tree: check:slow runs at pre-push, where
 * the content being pushed is already committed, so uncommitted scratch edits must not decide
 * whether the gate runs. (skill-lint diffs the working tree instead because it runs at
 * pre-commit, before the commit exists.)
 *
 * A stale local trunk only ever makes this set **bigger** — the merge-base moves back and picks
 * up trunk's own intervening commits — so the failure mode is a needless full run, never a
 * wrongly-skipped gate.
 */
export function changedPathsSinceTrunk(): readonly string[] | undefined {
  const trunk = TRUNK_REFS.find((ref) => {
    const probe = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { encoding: 'utf8' });
    return probe.status === 0;
  });
  if (trunk === undefined) return undefined;
  const base = spawnSync('git', ['merge-base', 'HEAD', trunk], { encoding: 'utf8' });
  if (base.status !== 0) return undefined;
  const mergeBase = base.stdout.trim();
  if (mergeBase.length === 0) return undefined;
  const diff = spawnSync('git', ['diff', '--name-only', mergeBase, 'HEAD'], { encoding: 'utf8' });
  if (diff.status !== 0) return undefined;
  return diff.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
