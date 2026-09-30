import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { jest } from '@jest/globals';

import { findConfigFile, findSecrets } from './secrets.ts';

// The engine loads secretlint and its rules on first use.
jest.setTimeout(60_000);

// Assembled at runtime so this file stays clean under the very scan it tests.
const PASSWORD = ['Qz7', 'vLk2', 'Rw9pT'].join('');
const LEAKED_URI = `postgresql://postgres.abcdefghijklmnop:${PASSWORD}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`;

describe('findConfigFile', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'showboat-secrets-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the config in the start directory', () => {
    writeFileSync(path.join(root, '.secretlintrc.json'), '{}');
    expect(findConfigFile(root)).toBe(path.join(root, '.secretlintrc.json'));
  });

  it('walks up parent directories until it finds the config', () => {
    writeFileSync(path.join(root, '.secretlintrc.json'), '{}');
    const deep = path.join(root, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    expect(findConfigFile(deep)).toBe(path.join(root, '.secretlintrc.json'));
  });

  it('prefers the nearest config', () => {
    writeFileSync(path.join(root, '.secretlintrc.json'), '{}');
    const inner = path.join(root, 'inner');
    mkdirSync(inner);
    writeFileSync(path.join(inner, '.secretlintrc.json'), '{}');
    expect(findConfigFile(inner)).toBe(path.join(inner, '.secretlintrc.json'));
  });

  it('throws (fails closed) when no directory up to the root has one', () => {
    // A temp dir has no config above it; if a machine ever did, this would need a different root.
    expect(() => findConfigFile(root)).toThrow(/\.secretlintrc\.json/);
  });

  it('finds the repo config from this module, wherever a sandbox copy of it runs', () => {
    const found = findConfigFile(import.meta.dirname);
    expect(path.basename(found)).toBe('.secretlintrc.json');
    expect(import.meta.dirname.startsWith(path.dirname(found) + path.sep)).toBe(true);
    expect(readFileSync(found, 'utf8')).toContain('rules');
  });
});

describe('findSecrets', () => {
  const saved = process.env['PGPASSWORD'];

  afterEach(() => {
    if (saved === undefined) delete process.env['PGPASSWORD'];
    else process.env['PGPASSWORD'] = saved;
  });

  it('returns undefined for clean content', async () => {
    delete process.env['PGPASSWORD'];
    expect(await findSecrets('hello world', '<note>')).toBeUndefined();
  });

  it('still reports a pattern match, masked and headed by the label', async () => {
    delete process.env['PGPASSWORD'];
    const report = await findSecrets(`psql ${LEAKED_URI}`, '<command>');
    expect(report).toContain('<command>');
    expect(report).not.toContain(PASSWORD);
  });

  it('refuses a bare live password no pattern would catch, without printing it', async () => {
    process.env['PGPASSWORD'] = PASSWORD;
    const report = await findSecrets(`$ printenv PGPASSWORD\n${PASSWORD}\n`, '<command output>');
    expect(report).toContain('<command output>');
    expect(report).toContain('contains the value of $PGPASSWORD');
    expect(report).not.toContain(PASSWORD);
  });

  it('refuses a live value in node inspect output', async () => {
    process.env['PGPASSWORD'] = PASSWORD;
    expect(await findSecrets(`{ password: '${PASSWORD}' }`, '<command output>')).toContain(
      '$PGPASSWORD',
    );
  });

  it('refuses UTF-16 output holding a live value', async () => {
    process.env['PGPASSWORD'] = PASSWORD;
    const utf16 = `${PASSWORD}\n`.replaceAll(/(?<=.)(?=.)/gs, '\0');
    expect(await findSecrets(utf16, '<command output>')).toContain('$PGPASSWORD');
  });

  it('reports both the pattern finding and the live value', async () => {
    process.env['PGPASSWORD'] = PASSWORD;
    const report = await findSecrets(`${LEAKED_URI}\nand ${PASSWORD}`, '<note>');
    expect(report).toContain('PostgreSQL');
    expect(report).toMatch(/\n<note>\n {2}contains the value of \$PGPASSWORD/);
    expect(report).toContain('contains the value of $PGPASSWORD');
    expect(report).not.toContain(PASSWORD);
  });

  it('cannot be silenced by a secretlint-disable comment', async () => {
    delete process.env['PGPASSWORD'];
    const report = await findSecrets(`<!-- secretlint-disable -->\n${LEAKED_URI}`, '<note>');
    expect(report).toContain('PostgreSQL');
  });

  it('ignores a trivial live value', async () => {
    process.env['PGPASSWORD'] = 'postgres';
    expect(await findSecrets('user postgres, password postgres', '<note>')).toBeUndefined();
  });
});
