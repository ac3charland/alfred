import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gatherDemos, readDeclaredBranch } from './demos.ts';

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
