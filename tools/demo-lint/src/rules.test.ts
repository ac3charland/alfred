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

describe('lint orchestration', () => {
  it('registers the two rules', () => {
    expect(rules.map((rule) => rule.name)).toEqual(['no-root-files', 'branch-folder']);
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
