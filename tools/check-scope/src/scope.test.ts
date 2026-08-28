import { decideScope, isDocsPath } from './scope.ts';

describe('isDocsPath', () => {
  it('accepts the docs directory itself and anything under it', () => {
    expect(isDocsPath('docs')).toBe(true);
    expect(isDocsPath('docs/specs/ALF-176.md')).toBe(true);
    expect(isDocsPath('docs/demos/foo/bar.md')).toBe(true);
  });

  it('rejects a path that merely starts with the same letters', () => {
    expect(isDocsPath('docsy/notes.md')).toBe(false);
    expect(isDocsPath('docs.md')).toBe(false);
  });

  it('rejects a nested docs folder inside a package', () => {
    expect(isDocsPath('frontend/docs/readme.md')).toBe(false);
  });
});

describe('decideScope', () => {
  it('skips when every change on the branch is under docs/', () => {
    const decision = decideScope(['docs/specs/ALF-176.md', 'docs/demos/x/y.md']);
    expect(decision.run).toBe(false);
    expect(decision.reason).toContain('docs/');
  });

  it('runs when a single change falls outside docs/', () => {
    expect(decideScope(['frontend/app/page.tsx']).run).toBe(true);
  });

  it('runs when docs changes are mixed with code changes', () => {
    const decision = decideScope(['docs/specs/ALF-176.md', 'frontend/lib/tree.ts']);
    expect(decision.run).toBe(true);
  });

  it('names an offending path so the reason is actionable', () => {
    expect(decideScope(['docs/a.md', 'workers/src/index.ts']).reason).toContain(
      'workers/src/index.ts',
    );
  });

  it('runs when the diff vs trunk is unknown', () => {
    // Conservative: git gave us nothing, so never skip a gate on a guess.
    expect(decideScope().run).toBe(true);
  });

  it('runs when nothing changed vs trunk', () => {
    // An empty diff is trunk itself (or an unrecognizable checkout) — not a docs-only branch.
    expect(decideScope([]).run).toBe(true);
  });

  it('runs a docs-only branch anyway when the full tier is forced', () => {
    const decision = decideScope(['docs/specs/ALF-176.md'], true);
    expect(decision.run).toBe(true);
    expect(decision.reason).toContain('CHECK_SCOPE_ALL');
  });
});
