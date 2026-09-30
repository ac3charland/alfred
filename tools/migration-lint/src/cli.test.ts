import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { jest } from '@jest/globals';

// Each case spawns the real CLI — the exit code is what CI and the pre-commit hook act on.
jest.setTimeout(30_000);

const CLI = fileURLToPath(new URL('cli.ts', import.meta.url));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'migration-lint-cli-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function migrations(...names: string[]): void {
  for (const name of names) writeFileSync(path.join(dir, name), 'select 1;\n');
}

function lint(...options: string[]): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', [CLI, ...options, dir], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('migration-lint CLI', () => {
  it('exits 0 when every migration number is unique', () => {
    migrations('0001_a.sql', '0002_b.sql');
    const { code, stdout } = lint();
    expect(code).toBe(0);
    expect(stdout).toContain('0 error(s)');
  });

  it('exits 1 and names the clash when two migrations share a number', () => {
    migrations('0001_a.sql', '0002_first.sql', '0002_second.sql');
    const { code, stdout } = lint();
    expect(code).toBe(1);
    expect(stdout).toContain('[unique-number]');
    expect(stdout).toContain('0002_first.sql');
    expect(stdout).toContain('0002_second.sql');
  });

  describe('--rule', () => {
    it('still fails the named rule', () => {
      migrations('0001_a.sql', '0002_first.sql', '0002_second.sql');
      const { code, stdout } = lint('--rule', 'unique-number');
      expect(code).toBe(1);
      expect(stdout).toContain('[unique-number]');
    });

    it('skips every rule it was not asked for', () => {
      // An ungranted sequence fails sequence-grant, so the unfiltered run is red; a run scoped to
      // unique-number must not report it (the numbers job owns numbers, check:fast owns grants).
      writeFileSync(path.join(dir, '0001_seq.sql'), 'create sequence foo_seq;\n');
      expect(lint().code).toBe(1);
      expect(lint('--rule', 'unique-number').code).toBe(0);
    });

    it('takes several rules', () => {
      writeFileSync(path.join(dir, '0001_seq.sql'), 'create sequence foo_seq;\n');
      expect(lint('--rule', 'unique-number', '--rule', 'sequence-grant').code).toBe(1);
    });

    it('rejects an unknown rule, listing the real ones', () => {
      migrations('0001_a.sql');
      const { code, stderr } = lint('--rule', 'no-such-rule');
      expect(code).toBe(2);
      expect(stderr).toContain('no-such-rule');
      expect(stderr).toContain('unique-number');
    });

    it('rejects a missing rule name', () => {
      migrations('0001_a.sql');
      const result = spawnSync('node', [CLI, dir, '--rule'], { encoding: 'utf8' });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('--rule needs a rule name');
    });
  });
});
