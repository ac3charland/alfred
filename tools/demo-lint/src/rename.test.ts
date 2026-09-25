import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** Archive the e2e spec into docs/ on a branch of its own, and commit the move. */
function commitArchive(): void {
  git('checkout', '-qb', 'archive-the-spec');
  git('mv', 'frontend/e2e/tasks.spec.ts', 'docs/tasks.spec.ts');
  git('commit', '-qm', 'archive');
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
  commitArchive();

  const changed = changedPathsSinceTrunk(gitEnvironment());
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

/**
 * A throwaway decoy stands in for the repository a hook pins, so a fixture that inherits the pin
 * writes into the decoy here — where once it rewrote a real branch, index and shared config.
 */
describe('run from a git hook', () => {
  let decoy: string;
  const pinned = ['GIT_DIR', 'GIT_INDEX_FILE'] as const;
  const outside = new Map<string, string | undefined>();

  beforeAll(() => {
    decoy = mkdtempSync(path.join(os.tmpdir(), 'demo-lint-decoy-'));
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
    commitArchive();

    expect(changedPathsSinceTrunk(gitEnvironment())).toContain('frontend/e2e/tasks.spec.ts');
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
