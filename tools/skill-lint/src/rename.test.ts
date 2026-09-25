import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * The variables that pin git to one repository, as git itself lists them. Git exports them to its
 * hooks (githooks(5)) so a hook's own commands find the repository being committed to — and this
 * suite runs inside the pre-commit hook.
 */
const REPO_VARIABLES = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' })
  .split('\n')
  .filter((name) => name.length > 0);

/**
 * The environment every git command in this file runs with, the function under test's included:
 * this process's own, minus every repo pin. Handed over explicitly because Jest's `process.env` is
 * the test's own copy — deleting from it never reaches a child process, which would inherit the
 * real environment, pins and all.
 */
function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of REPO_VARIABLES) Reflect.deleteProperty(environment, name);
  return environment;
}

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'pipe', env: gitEnvironment() });
}

/** Move alpha's SKILL.md into beta on a branch of its own, and commit the move. */
function commitRename(): void {
  git('checkout', '-qb', 'move-a-resource');
  git('mv', '.claude/skills/alpha/SKILL.md', '.claude/skills/beta/MOVED.md');
  git('commit', '-qm', 'move');
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
  commitRename();

  const changed = changedPathsSinceTrunk(gitEnvironment());

  // Without --no-renames git prints only the destination, so `alpha` looks untouched and
  // never gets re-linted even though its SKILL.md just disappeared.
  expect(changed).toContain('.claude/skills/alpha/SKILL.md');
  expect(changed).toContain('.claude/skills/beta/MOVED.md');
});

/**
 * A throwaway decoy stands in for the repository a hook pins, so a fixture that inherits the pin
 * writes into the decoy here — where once it rewrote a real branch, index and shared config.
 */
describe('run from a git hook', () => {
  let decoy: string;
  const pinned = ['GIT_DIR', 'GIT_INDEX_FILE'] as const;
  const outside = new Map<string, string | undefined>();

  beforeAll(() => {
    decoy = mkdtempSync(path.join(os.tmpdir(), 'skill-lint-decoy-'));
    execFileSync('git', ['init', '-q'], { cwd: decoy, stdio: 'pipe', env: gitEnvironment() });
    for (const name of pinned) outside.set(name, process.env[name]);
    process.env['GIT_DIR'] = path.join(decoy, '.git');
    process.env['GIT_INDEX_FILE'] = path.join(decoy, '.git', 'index');
  });

  afterAll(() => {
    for (const [name, value] of outside) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
    rmSync(decoy, { recursive: true, force: true });
  });

  it('works in its own fixture and never touches the pinned repository', () => {
    commitRename();

    expect(changedPathsSinceTrunk(gitEnvironment())).toContain('.claude/skills/alpha/SKILL.md');
    const decoyHead = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {
      cwd: decoy,
      env: { ...gitEnvironment(), GIT_DIR: path.join(decoy, '.git') },
    });
    expect(decoyHead.status).not.toBe(0);
    expect(readFileSync(path.join(decoy, '.git', 'config'), 'utf8')).not.toContain(
      'test@example.com',
    );
  });
});
