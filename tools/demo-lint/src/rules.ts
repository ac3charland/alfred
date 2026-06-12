import { ALLOWED_ROOT_FILES, type DemosContext } from './demos.ts';

export type Severity = 'error' | 'warn';

/** One problem a rule found in the demos directory. */
export interface Finding {
  /** The id of the rule that produced this finding. */
  readonly rule: string;
  /** `error` fails the lint; `warn` is advisory and never fails it. */
  readonly severity: Severity;
  /** Human-readable explanation plus how to fix it. */
  readonly message: string;
}

/**
 * A lint rule: a pure check over a {@link DemosContext}. To add a rule, write one
 * of these and register it in {@link rules} below — nothing else needs to change.
 */
export interface Rule {
  /** Stable id, shown in findings (e.g. `no-root-files`). */
  readonly name: string;
  /** One-line summary of what the rule enforces. */
  readonly description: string;
  /** Return a finding per problem, or `[]` when the demos pass. */
  check(demos: DemosContext): Finding[];
}

/**
 * Every demo lives in its own folder, so the only file allowed directly in
 * `docs/demos/` is the README. Any other loose file is a demo artifact that
 * should have been captured inside a folder.
 */
const noRootFiles: Rule = {
  name: 'no-root-files',
  description:
    'Only README.md may sit directly in docs/demos/; every demo lives in its own folder.',
  check(demos) {
    return demos.rootFiles
      .filter((name) => !ALLOWED_ROOT_FILES.has(name))
      .map((name) => ({
        rule: 'no-root-files',
        severity: 'error' as const,
        message: `${demos.displayPath}/${name} is a file directly in ${demos.displayPath}/. Every demo lives in its own folder — move it into ${demos.displayPath}/<branch-or-feature>/.`,
      }));
  },
};

/**
 * While developing a feature branch, its demo belongs in a folder named after the
 * branch. The rule skips trunk and an undeterminable branch so it only fires where
 * a real, missing branch folder is the problem.
 */
const branchFolder: Rule = {
  name: 'branch-folder',
  description: 'Each feature branch must capture its demo in docs/demos/<current-branch>/.',
  check(demos) {
    if (demos.branchFolder === undefined) return []; // trunk, detached HEAD, or no git.
    if (demos.branchFolderHasContent) return [];
    return [
      {
        rule: 'branch-folder',
        severity: 'error',
        message: `branch "${demos.branchFolder}" has no demo folder. Create ${demos.displayPath}/${demos.branchFolder}/ and capture this branch's demo there (e.g. npm run demo -- init ${demos.displayPath}/${demos.branchFolder}/<name>.md "<title>").`,
      },
    ];
  },
};

/**
 * The active rule set, applied to the demos directory in registration order. This
 * array is the extension point: append a {@link Rule} to lint something new.
 */
export const rules: readonly Rule[] = [noRootFiles, branchFolder];
