import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { changedPathsSinceTrunk } from './git.ts';

/**
 * Renames are the case where a diff can lie about what a branch changed: git's default rename
 * detection reports only the destination, hiding the deleted source. This drives a real repo
 * through the function rather than mocking git, because the bug lives in git's own defaults.
 */
let repo: string;
let cwd: string;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
}

beforeEach(() => {
  cwd = process.cwd();
  repo = mkdtempSync(path.join(os.tmpdir(), 'skill-lint-rename-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  mkdirSync(path.join(repo, '.claude/skills/alpha'), { recursive: true });
  mkdirSync(path.join(repo, '.claude/skills/beta'), { recursive: true });
  writeFileSync(path.join(repo, '.claude/skills/alpha/SKILL.md'), '# alpha\n');
  writeFileSync(path.join(repo, '.claude/skills/beta/SKILL.md'), '# beta\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(repo, { recursive: true, force: true });
});

it('reports both sides of a rename, not just the destination', () => {
  git('checkout', '-qb', 'move-a-resource');
  git('mv', '.claude/skills/alpha/SKILL.md', '.claude/skills/beta/MOVED.md');
  git('commit', '-qm', 'move');

  const changed = changedPathsSinceTrunk();

  // Without --no-renames git prints only the destination, so `alpha` looks untouched and
  // never gets re-linted even though its SKILL.md just disappeared.
  expect(changed).toContain('.claude/skills/alpha/SKILL.md');
  expect(changed).toContain('.claude/skills/beta/MOVED.md');
});
