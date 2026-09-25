import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** Trunk refs to diff against, in priority order (first existing one wins). */
const TRUNK_REFS: readonly string[] = ['origin/main', 'main', 'origin/master', 'master'];

/** A changed path under `.claude/skills/<name>/…` → the `<name>` it belongs to. */
const SKILL_PATH = /(?:^|\/)\.claude\/skills\/([^/]+)\//;

/**
 * Repo-relative paths changed on the current branch vs the trunk merge-base, or `undefined`
 * when git can't tell us — no git, no trunk ref among {@link TRUNK_REFS} (e.g. a shallow CI
 * checkout), or any command failing. The diff is taken against the **working tree** (not
 * `HEAD`) so a skill that's edited or staged but not yet committed still counts — skill-lint
 * runs at pre-commit, before the commit exists. An `undefined` result is the caller's signal
 * to lint **everything** (conservative: never silently skip on an unknown diff).
 *
 * `--no-renames` is load-bearing: git's default rename detection prints only a move's
 * destination, so a file moved out of a skill would leave that skill looking untouched and
 * silently unlinted.
 *
 * Git runs with `environment`, the caller's own by default — which is what lets it find the repo
 * from inside the pre-commit hook. A test driving a throwaway repo passes one without the
 * repo-pinning variables that hook exports, or git answers about the real repo instead.
 */
export function changedPathsSinceTrunk(
  environment: NodeJS.ProcessEnv = process.env,
): readonly string[] | undefined {
  const run = (args: string[]) => spawnSync('git', args, { encoding: 'utf8', env: environment });
  const trunk = TRUNK_REFS.find(
    (ref) => run(['rev-parse', '--verify', '--quiet', ref]).status === 0,
  );
  if (trunk === undefined) return undefined;
  const base = run(['merge-base', 'HEAD', trunk]);
  if (base.status !== 0) return undefined;
  const mergeBase = base.stdout.trim();
  if (mergeBase.length === 0) return undefined;
  const diff = run(['diff', '--no-renames', '--name-only', mergeBase]);
  if (diff.status !== 0) return undefined;
  return diff.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The set of skill names touched by `changedPaths`, or `undefined` when the diff is unknown
 * (mirrors {@link changedPathsSinceTrunk}'s `undefined`). A change anywhere under a skill's
 * folder — its SKILL.md or any bundled resource — counts the skill as changed.
 */
export function changedSkillNames(changedPaths?: readonly string[]): Set<string> | undefined {
  if (changedPaths === undefined) return undefined;
  const names = new Set<string>();
  for (const changed of changedPaths) {
    const match = SKILL_PATH.exec(changed);
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return names;
}

/**
 * Narrow resolved SKILL.md paths to those whose skill (its folder name) changed. An
 * `undefined` change set means "diff unknown" → lint everything, so the gate never goes
 * quiet on a guess.
 */
export function selectChangedSkills(
  skillMdPaths: readonly string[],
  changedNames?: Set<string>,
): string[] {
  if (changedNames === undefined) return [...skillMdPaths];
  return skillMdPaths.filter((skillMdPath) =>
    changedNames.has(path.basename(path.dirname(skillMdPath))),
  );
}
