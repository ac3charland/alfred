import type { DemosContext } from './demos.ts';
import { countBySeverity, lintDemos } from './lint.ts';
import { rules } from './rules.ts';

function makeDemos(overrides: Partial<DemosContext> = {}): DemosContext {
  return {
    demosDir: '/repo/docs/demos',
    displayPath: 'docs/demos',
    rootFiles: ['README.md'],
    branch: 'main',
    branchFolder: undefined,
    branchFolderHasContent: false,
    declaredBranches: [],
    demoContents: [],
    hasChangesOutsideDocs: true,
    ...overrides,
  };
}

function findingsFor(rule: string, demos: DemosContext): ReturnType<typeof lintDemos> {
  return lintDemos(demos).filter((finding) => finding.rule === rule);
}

describe('no-root-files', () => {
  it('allows README.md at the root', () => {
    expect(findingsFor('no-root-files', makeDemos({ rootFiles: ['README.md'] }))).toHaveLength(0);
  });

  it('errors on a loose demo file directly in docs/demos/', () => {
    const [finding] = findingsFor(
      'no-root-files',
      makeDemos({ rootFiles: ['README.md', 'stray.md'] }),
    );
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('stray.md');
  });

  it('reports one finding per offending file', () => {
    expect(findingsFor('no-root-files', makeDemos({ rootFiles: ['a.md', 'b.png'] }))).toHaveLength(
      2,
    );
  });
});

describe('branch-folder', () => {
  it('skips trunk — no branch folder required on main', () => {
    expect(
      findingsFor('branch-folder', makeDemos({ branch: 'main', branchFolder: undefined })),
    ).toHaveLength(0);
  });

  it('skips when the branch is unknown (detached HEAD / no git)', () => {
    expect(
      findingsFor('branch-folder', makeDemos({ branch: undefined, branchFolder: undefined })),
    ).toHaveLength(0);
  });

  it('errors when a feature branch has no demo (no front matter, no branch folder)', () => {
    const [finding] = findingsFor(
      'branch-folder',
      makeDemos({
        branch: 'claude/foo',
        branchFolder: 'claude/foo',
        branchFolderHasContent: false,
        declaredBranches: ['some/other-branch'],
      }),
    );
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('claude/foo');
  });

  it('skips a docs-only branch with no demo (every change under docs/)', () => {
    expect(
      findingsFor(
        'branch-folder',
        makeDemos({
          branch: 'claude/foo',
          branchFolder: 'claude/foo',
          branchFolderHasContent: false,
          declaredBranches: [],
          hasChangesOutsideDocs: false,
        }),
      ),
    ).toHaveLength(0);
  });

  it('passes when a demo doc declares this branch in front matter (any folder name)', () => {
    expect(
      findingsFor(
        'branch-folder',
        makeDemos({
          branch: 'claude/foo',
          branchFolder: 'claude/foo',
          branchFolderHasContent: false,
          declaredBranches: ['claude/foo'],
        }),
      ),
    ).toHaveLength(0);
  });

  it('still passes via a legacy branch-named folder with content', () => {
    expect(
      findingsFor(
        'branch-folder',
        makeDemos({
          branch: 'claude/foo',
          branchFolder: 'claude/foo',
          branchFolderHasContent: true,
          declaredBranches: [],
        }),
      ),
    ).toHaveLength(0);
  });
});

describe('no-test-in-demo', () => {
  it('passes when no demo files contain npm run test', () => {
    expect(
      findingsFor(
        'no-test-in-demo',
        makeDemos({
          demoContents: [
            { relativePath: 'my-feature/demo.md', content: 'curl localhost:3000/api/items' },
          ],
        }),
      ),
    ).toHaveLength(0);
  });

  it('errors when a demo file contains npm run test', () => {
    const [finding] = findingsFor(
      'no-test-in-demo',
      makeDemos({
        demoContents: [
          {
            relativePath: 'my-feature/demo.md',
            content: 'npm run test -w frontend -- --testPathPatterns=date-utils',
          },
        ],
      }),
    );
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('my-feature/demo.md');
    expect(finding?.message).toContain('npm run test');
  });

  it('reports one finding per offending file', () => {
    expect(
      findingsFor(
        'no-test-in-demo',
        makeDemos({
          demoContents: [
            { relativePath: 'feat-a/demo.md', content: 'npm run test -w frontend' },
            { relativePath: 'feat-b/demo.md', content: 'curl localhost/api' },
            { relativePath: 'feat-c/demo.md', content: 'npm run test -w workers' },
          ],
        }),
      ),
    ).toHaveLength(2);
  });
});

describe('lint orchestration', () => {
  it('registers the three rules', () => {
    expect(rules.map((rule) => rule.name)).toEqual([
      'no-root-files',
      'branch-folder',
      'no-test-in-demo',
    ]);
  });

  it('tallies errors and warnings', () => {
    const findings = lintDemos(
      makeDemos({
        rootFiles: ['stray.md'],
        branch: 'claude/foo',
        branchFolder: 'claude/foo',
        branchFolderHasContent: false,
      }),
    );
    expect(countBySeverity(findings)).toEqual({ errors: 2, warnings: 0 });
  });
});
