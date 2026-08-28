import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { changedPathsSinceTrunk, gatherDemos } from './demos.ts';

/**
 * A rename is where the changed-file diff can lie: git's default rename detection reports only
 * the destination, so moving code into `docs/` looks like a pure docs change. That would hand a
 * code-changing branch the docs-only exemption from `branch-folder`. Driven through a real repo,
 * because the bug is in git's own defaults rather than in our logic.
 */
let repo: string;
let cwd: string;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
}

beforeEach(() => {
  cwd = process.cwd();
  repo = mkdtempSync(path.join(os.tmpdir(), 'demo-lint-rename-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  mkdirSync(path.join(repo, 'frontend/e2e'), { recursive: true });
  mkdirSync(path.join(repo, 'docs/demos'), { recursive: true });
  writeFileSync(path.join(repo, 'frontend/e2e/tasks.spec.ts'), 'test("x", () => {});\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(repo, { recursive: true, force: true });
});

it('sees the deleted source when code is moved into docs/', () => {
  git('checkout', '-qb', 'archive-the-spec');
  git('mv', 'frontend/e2e/tasks.spec.ts', 'docs/tasks.spec.ts');
  git('commit', '-qm', 'archive');

  const changed = changedPathsSinceTrunk();
  expect(changed).toContain('frontend/e2e/tasks.spec.ts');

  // …so the branch is NOT docs-only and still owes a demo, even though every path git
  // reported by default lived under docs/.
  const demos = gatherDemos(
    path.join(repo, 'docs/demos'),
    repo,
    'archive-the-spec',
    changed,
    false,
  );
  expect(demos.hasChangesOutsideDocs).toBe(true);
});
