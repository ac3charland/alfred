import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gatherDemos } from './demos.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'demo-lint-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(...segments: string[]): void {
  const file = path.join(root, ...segments);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'x');
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
});
