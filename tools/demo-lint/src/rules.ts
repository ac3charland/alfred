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
 * While developing a feature branch, it must own a demo. A demo claims its branch by
 * declaring `branch: <name>` in the doc's YAML front matter (so the folder can carry a
 * semantic feature name instead of the branch), and `npm run demo -- init` stamps that
 * automatically. A legacy folder named after the branch with content still satisfies it.
 * The rule skips trunk and an undeterminable branch so it only fires on a real feature
 * branch that has no demo at all. It also skips a **docs-only** branch — one whose every
 * change lives under `docs/` — since such a change owes no demo.
 */
const branchFolder: Rule = {
  name: 'branch-folder',
  description: 'Each feature branch must own a demo, tagged with branch in its front matter.',
  check(demos) {
    if (demos.branchFolder === undefined) return []; // trunk, detached HEAD, or no git.
    if (!demos.hasChangesOutsideDocs) return []; // docs-only branch owes no demo.
    if (demos.declaredBranches.includes(demos.branchFolder)) return []; // claimed in front matter.
    if (demos.branchFolderHasContent) return []; // legacy: folder named after the branch.
    return [
      {
        rule: 'branch-folder',
        severity: 'error',
        message: `branch "${demos.branchFolder}" has no demo. Capture it in its own folder under ${demos.displayPath}/ — npm run demo -- init ${demos.displayPath}/<feature-name>/<name>.md "<title>" records this branch in the doc's front matter automatically.`,
      },
    ];
  },
};

/**
 * Demo docs must show the new behavior directly — a screenshot, a real request/response,
 * or a function's output. Running the test suite (`npm run test`) in a demo proves nothing
 * the pre-commit gate doesn't already prove, and shows a reviewer nothing they can see.
 *
 * Only ```bash exec blocks are checked — output blocks may mention "npm run test" as part
 * of captured terminal output (e.g. showing what a script expands to) without triggering
 * this rule.
 */
function bashExecContent(content: string): string {
  const blocks: string[] = [];
  const re = /^```bash\r?\n([\s\S]*?)^```/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    blocks.push(match[1] ?? '');
  }
  return blocks.join('\n');
}

const noTestInDemo: Rule = {
  name: 'no-test-in-demo',
  description:
    'Demo exec blocks must not run the test suite — show the new behavior (UI screenshot or real output) instead.',
  check(demos) {
    return demos.demoContents
      .filter(({ content }) => /npm run test(?!:)/.test(bashExecContent(content)))
      .map(({ relativePath }) => ({
        rule: 'no-test-in-demo',
        severity: 'error' as const,
        message: `${demos.displayPath}/${relativePath} contains "npm run test". Tests prove the change doesn't regress; a demo must show the new behavior — screenshot the UI or capture a real request/response.`,
      }));
  },
};

/**
 * The active rule set, applied to the demos directory in registration order. This
 * array is the extension point: append a {@link Rule} to lint something new.
 */
export const rules: readonly Rule[] = [noRootFiles, branchFolder, noTestInDemo];
