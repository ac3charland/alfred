import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { jest } from '@jest/globals';

// Each case spawns the real CLI — the exit code is what the PR body workflow acts on.
jest.setTimeout(30_000);

const CLI = fileURLToPath(new URL('cli.ts', import.meta.url));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'pr-body-lint-cli-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function lintFile(body: string): { code: number | null; stdout: string; stderr: string } {
  const file = path.join(dir, 'body.md');
  writeFileSync(file, body);
  const result = spawnSync(process.execPath, [CLI, file], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('pr-body-lint CLI', () => {
  it('exits 0 on a clean body', () => {
    const { code, stdout } = lintFile('[demo](https://example.com/demo.md)\n');
    expect(code).toBe(0);
    expect(stdout).toContain('0 error(s)');
  });

  it('exits 1 and names the line and URL of a double-backticked URL', () => {
    const { code, stdout } = lintFile('ok\n[demo](``https://example.com/demo.md``)\n');
    expect(code).toBe(1);
    expect(stdout).toContain('line 2');
    expect(stdout).toContain('https://example.com/demo.md');
    expect(stdout).toContain('1 error(s)');
  });

  it('reads the body from stdin when given no file', () => {
    const result = spawnSync(process.execPath, [CLI], {
      encoding: 'utf8',
      input: '``https://example.com``',
    });
    expect(result.status).toBe(1);
  });

  it('exits 2 when the file does not exist', () => {
    const result = spawnSync(process.execPath, [CLI, path.join(dir, 'missing.md')], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not found');
  });
});
