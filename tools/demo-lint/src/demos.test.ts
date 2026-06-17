import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { changedDemoKeys, chooseTrunkRef, gatherDemos, readDeclaredBranch } from './demos.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'demo-lint-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(...segments: string[]): void {
  write('x', ...segments);
}

function write(content: string, ...segments: string[]): string {
  const file = path.join(root, ...segments);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

/** A minimal demo doc that declares `branch` in YAML front matter. */
function demoDoc(branch: string): string {
  return `---\nbranch: ${branch}\n---\n\n# Demo\n\n*ts*\n`;
}

describe('gatherDemos', () => {
  it('lists plain root files sorted and ignores directories', () => {
    touch('README.md');
    touch('b-stray.md');
    touch('a-stray.png');
    mkdirSync(path.join(root, 'a-feature'), { recursive: true });
    expect(gatherDemos(root, root, 'main').rootFiles).toEqual([
      'README.md',
      'a-stray.png',
      'b-stray.md',
    ]);
  });

  it('treats main as trunk — no branch folder owed', () => {
    const demos = gatherDemos(root, root, 'main');
    expect(demos.branchFolder).toBeUndefined();
    expect(demos.branchFolderHasContent).toBe(false);
  });

  it('treats an undeterminable branch as no branch folder owed', () => {
    expect(gatherDemos(root, root).branchFolder).toBeUndefined();
  });

  it('maps a slashed branch name to a nested folder and detects its content', () => {
    touch('claude', 'foo-bar', 'demo.md');
    const demos = gatherDemos(root, root, 'claude/foo-bar');
    expect(demos.branchFolder).toBe('claude/foo-bar');
    expect(demos.branchFolderHasContent).toBe(true);
  });

  it('reports no content when the branch folder is missing', () => {
    const demos = gatherDemos(root, root, 'feat/x');
    expect(demos.branchFolder).toBe('feat/x');
    expect(demos.branchFolderHasContent).toBe(false);
  });

  it('reports no content when the branch folder exists but is empty', () => {
    mkdirSync(path.join(root, 'feat', 'x'), { recursive: true });
    expect(gatherDemos(root, root, 'feat/x').branchFolderHasContent).toBe(false);
  });

  it('shows the demos path relative to the cwd', () => {
    expect(gatherDemos(root, path.dirname(root), 'main').displayPath).toBe(path.basename(root));
  });

  it('collects branches declared in demo-doc front matter, regardless of folder name', () => {
    // A semantically-named folder whose doc declares a different branch in front matter.
    write(demoDoc('claude/foo-bar'), 'cool-feature', 'demo.md');
    write(demoDoc('feat/widgets'), 'another-feature', 'demo.md');
    expect(gatherDemos(root, root, 'claude/foo-bar').declaredBranches).toEqual([
      'claude/foo-bar',
      'feat/widgets',
    ]);
  });

  it('ignores demo docs that carry no front matter', () => {
    write('# No front matter\n\n*ts*\n', 'plain', 'demo.md');
    expect(gatherDemos(root, root, 'main').declaredBranches).toEqual([]);
  });

  it('deduplicates a branch declared by more than one demo doc', () => {
    write(demoDoc('feat/x'), 'a', 'demo.md');
    write(demoDoc('feat/x'), 'b', 'demo.md');
    expect(gatherDemos(root, root, 'main').declaredBranches).toEqual(['feat/x']);
  });

  it('reports no changes outside docs when every changed path is under docs/', () => {
    const changed = ['docs/code-module-spec.md', 'docs/demos/x/y.md'];
    expect(gatherDemos(root, root, 'feat/x', changed).hasChangesOutsideDocs).toBe(false);
  });

  it('reports changes outside docs when a changed path is outside docs/', () => {
    const changed = ['tools/demo-lint/src/rules.ts'];
    expect(gatherDemos(root, root, 'feat/x', changed).hasChangesOutsideDocs).toBe(true);
  });

  it('reports changes outside docs for a mixed change set', () => {
    const changed = ['docs/code-module-spec.md', 'tools/demo-lint/src/rules.ts'];
    expect(gatherDemos(root, root, 'feat/x', changed).hasChangesOutsideDocs).toBe(true);
  });

  it('conservatively reports changes outside docs when the diff is unknown', () => {
    expect(gatherDemos(root, root, 'feat/x').hasChangesOutsideDocs).toBe(true);
  });

  it('changed-only mode narrows demoContents and rootFiles to the demos that changed', () => {
    write('# old — runs npm run test\n', 'old-demo', 'demo.md');
    write('# new\n', 'new-demo', 'demo.md');
    touch('stray.png'); // a root file that did not change
    const demos = gatherDemos(root, root, 'feat/x', ['docs/demos/new-demo/demo.md'], true);
    expect(demos.demoContents.map((c) => c.relativePath)).toEqual([
      path.join('new-demo', 'demo.md'),
    ]);
    expect(demos.rootFiles).toEqual([]);
  });

  it('changed-only mode keeps a changed root file', () => {
    touch('stray.md');
    expect(gatherDemos(root, root, 'feat/x', ['docs/demos/stray.md'], true).rootFiles).toEqual([
      'stray.md',
    ]);
  });

  it('changed-only mode lints every demo when the diff is unknown (conservative)', () => {
    write('# a\n', 'a', 'demo.md');
    write('# b\n', 'b', 'demo.md');
    expect(gatherDemos(root, root, 'feat/x', undefined, true).demoContents).toHaveLength(2);
  });

  it('default (not changed-only) lints every demo even with a known diff', () => {
    write('# a\n', 'a', 'demo.md');
    write('# b\n', 'b', 'demo.md');
    expect(gatherDemos(root, root, 'feat/x', ['docs/demos/a/demo.md']).demoContents).toHaveLength(
      2,
    );
  });
});

describe('chooseTrunkRef', () => {
  it('prefers the remote default branch (origin/HEAD) above all', () => {
    expect(
      chooseTrunkRef({
        originHead: 'origin/main',
        remote: ['origin/master'],
        local: ['main'],
        hasOrigin: true,
      }),
    ).toBe('origin/main');
  });

  it('falls back to the first existing remote trunk ref when origin/HEAD is unset', () => {
    expect(
      chooseTrunkRef({
        originHead: undefined,
        remote: ['origin/master'],
        local: ['main'],
        hasOrigin: true,
      }),
    ).toBe('origin/master');
  });

  it('never uses a local trunk when an origin remote exists — a stale local main would widen the diff', () => {
    // origin remote present but its trunk ref isn't fetched locally: prefer "unknown" over a
    // possibly-stale local `main`, so the gate matches CI instead of diffing a far-back base.
    expect(
      chooseTrunkRef({
        originHead: undefined,
        remote: [],
        local: ['main', 'master'],
        hasOrigin: true,
      }),
    ).toBeUndefined();
  });

  it('uses a local trunk branch only when there is no origin remote (standalone repo)', () => {
    expect(
      chooseTrunkRef({ originHead: undefined, remote: [], local: ['main'], hasOrigin: false }),
    ).toBe('main');
  });

  it('returns undefined when nothing resolves at all', () => {
    expect(
      chooseTrunkRef({ originHead: undefined, remote: [], local: [], hasOrigin: false }),
    ).toBeUndefined();
  });
});

describe('changedDemoKeys', () => {
  it('maps changed paths to demo keys — a folder name, or a root file name', () => {
    expect(
      changedDemoKeys([
        'docs/demos/foo/bar.md',
        'docs/demos/foo/img.png',
        'docs/demos/stray.md',
        'frontend/app/page.tsx',
        'docs/code-module-spec.md',
      ]),
    ).toEqual(new Set(['foo', 'stray.md']));
  });

  it('passes through an unknown diff as undefined (lint everything)', () => {
    expect(changedDemoKeys()).toBeUndefined();
  });

  it('returns an empty set when nothing under docs/demos changed', () => {
    expect(changedDemoKeys(['frontend/app/page.tsx'])).toEqual(new Set());
  });
});

describe('readDeclaredBranch', () => {
  it("reads the branch from a doc's front matter", () => {
    const file = write(demoDoc('claude/foo-bar'), 'f', 'demo.md');
    expect(readDeclaredBranch(file)).toBe('claude/foo-bar');
  });

  it('strips surrounding quotes from the value', () => {
    const file = write('---\nbranch: "feat/x"\n---\n\n# D\n', 'f', 'demo.md');
    expect(readDeclaredBranch(file)).toBe('feat/x');
  });

  it('returns undefined when there is no front matter', () => {
    const file = write('# Plain\n\n*ts*\n', 'f', 'demo.md');
    expect(readDeclaredBranch(file)).toBeUndefined();
  });

  it('returns undefined when front matter has no branch key', () => {
    const file = write('---\ntitle: something\n---\n\n# D\n', 'f', 'demo.md');
    expect(readDeclaredBranch(file)).toBeUndefined();
  });

  it('returns undefined when the branch value is empty', () => {
    const file = write('---\nbranch:\n---\n\n# D\n', 'f', 'demo.md');
    expect(readDeclaredBranch(file)).toBeUndefined();
  });
});
