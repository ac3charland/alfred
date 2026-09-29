import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { committableFiles, isBinary, scanFiles } from './scan.ts';

// Every fixture secret is assembled at runtime from innocuous parts, so this file itself stays
// clean under the very scan it tests (the scanner reads source text, not evaluated values).
const PASSWORD = ['Qz7', 'vLk2', 'Rw9pT'].join('');
const LEAKED_URI = `postgresql://postgres.abcdefghijklmnop:${PASSWORD}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`;
const SUPABASE_SECRET_KEY = ['sb', 'secret', 'Xk29fLq8Zr4Tn6Vp1Wy3Bc5D'].join('_');
const SUPABASE_ACCESS_TOKEN = ['sbp', 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0'].join('_');

let repo: string;

function write(relative: string, content: string | Buffer): void {
  const file = path.join(repo, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

async function scanOne(
  relative: string,
  content: string,
): Promise<{ ok: boolean; output: string }> {
  write(relative, content);
  return scanFiles(repo, [relative]);
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'secret-scan-'));
  git('init', '--quiet');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('scanFiles', () => {
  it('flags a Postgres connection string that carries a password', async () => {
    const result = await scanOne('demo.md', `psql '${LEAKED_URI}' -c 'select 1'\n`);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('demo.md');
    expect(result.output).toContain('PostgreSQL connection string');
  });

  it('masks the secret in its report, so the report is safe to print in a public CI log', async () => {
    const result = await scanOne('demo.md', `${LEAKED_URI}\n`);
    expect(result.ok).toBe(false);
    expect(result.output).not.toContain(PASSWORD);
  });

  it('allows the documented `:<password>@` placeholder template', async () => {
    const template =
      'postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres';
    const result = await scanOne('SKILL.md', `${template}\n`);
    expect(result.ok).toBe(true);
  });

  it('passes the safe form that reads the URL from the environment', async () => {
    const result = await scanOne('demo.md', `psql "$DATABASE_URL" -c "select 1"\n`);
    expect(result.ok).toBe(true);
  });

  it('flags a Supabase secret API key but not the short mock/placeholder keys', async () => {
    const real = await scanOne('a.ts', `const key = '${SUPABASE_SECRET_KEY}';\n`);
    expect(real.ok).toBe(false);
    const placeholders = ['sb_secret_mock', 'sb_secret_placeholder', 'sb_secret_demo'];
    const result = await scanOne('b.ts', `${placeholders.join('\n')}\n`);
    expect(result.ok).toBe(true);
  });

  it('flags a Supabase personal access token', async () => {
    const result = await scanOne('env.md', `SUPABASE_ACCESS_TOKEN=${SUPABASE_ACCESS_TOKEN}\n`);
    expect(result.ok).toBe(false);
  });

  it('skips binary files', async () => {
    write(
      'shot.png',
      Buffer.concat([Buffer.from([0x89, 0x50, 0x00, 0x00]), Buffer.from(LEAKED_URI)]),
    );
    const result = await scanFiles(repo, ['shot.png']);
    expect(result).toEqual({ ok: true, output: '', scanned: 0 });
  });

  it('reports how many files it actually scanned', async () => {
    write('a.md', 'hello\n');
    write('b.md', 'world\n');
    const result = await scanFiles(repo, ['a.md', 'b.md']);
    expect(result).toEqual({ ok: true, output: '', scanned: 2 });
  });
});

describe('committableFiles', () => {
  it('lists tracked files, including ones staged but not yet committed', () => {
    write('committed.md', 'a\n');
    git('add', 'committed.md');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'init');
    write('nested/staged.md', 'b\n');
    git('add', 'nested/staged.md');
    expect(committableFiles(repo)).toEqual(['committed.md', 'nested/staged.md']);
  });

  it('lists a new file not yet staged, since the gate can run before `git add` (batch-commits does)', () => {
    write('committed.md', 'a\n');
    git('add', 'committed.md');
    write('nested/new.ts', 'b\n');
    expect(new Set(committableFiles(repo))).toEqual(new Set(['committed.md', 'nested/new.ts']));
  });

  it('never lists a gitignored file (.env.local), so local secrets cannot fail the gate', () => {
    write('.gitignore', '.env*\n');
    write('.env.local', `DATABASE_URL=${LEAKED_URI}\n`);
    git('add', '.gitignore');
    expect(committableFiles(repo)).toEqual(['.gitignore']);
  });

  it('skips a tracked file deleted from the working tree and a tracked symlink to a directory', () => {
    write('gone.md', 'a\n');
    mkdirSync(path.join(repo, 'dir'));
    write('dir/inner.md', 'b\n');
    execFileSync('ln', ['-s', 'dir', 'link'], { cwd: repo });
    git('add', '.');
    rmSync(path.join(repo, 'gone.md'));
    expect(committableFiles(repo)).toEqual(['dir/inner.md']);
  });
});

describe('isBinary', () => {
  it('treats content with a NUL byte in its first 8000 bytes as binary', () => {
    expect(isBinary(Buffer.from([0x41, 0x00, 0x42]))).toBe(true);
  });

  it('treats NUL-free content as text', () => {
    expect(isBinary(Buffer.from('plain text\n'))).toBe(false);
  });

  it('looks only at the first 8000 bytes, like git', () => {
    const late = Buffer.concat([Buffer.alloc(8000, 0x41), Buffer.from([0x00])]);
    expect(isBinary(late)).toBe(false);
  });
});
