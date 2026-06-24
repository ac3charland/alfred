import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MIGRATIONS_DIR, migrationFiles, sorted } from './migrate.ts';

describe('sorted', () => {
  it('orders lexicographically and returns a copy', () => {
    const input = ['0010_b.sql', '0002_a.sql', '0001_z.sql'];
    expect(sorted(input)).toStrictEqual(['0001_z.sql', '0002_a.sql', '0010_b.sql']);
    expect(input[0]).toBe('0010_b.sql'); // original left untouched
  });
});

describe('migrationFiles', () => {
  it('returns only .sql files in filename order, ignoring other files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'alfred-mig-'));
    try {
      writeFileSync(path.join(dir, '0002_b.sql'), '');
      writeFileSync(path.join(dir, '0001_a.sql'), '');
      writeFileSync(path.join(dir, 'README.md'), '');
      expect(migrationFiles(dir).map((file) => path.basename(file))).toStrictEqual([
        '0001_a.sql',
        '0002_b.sql',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves the real migrations dir, starting at the initial schema in apply order', () => {
    const files = migrationFiles(MIGRATIONS_DIR).map((file) => path.basename(file));
    expect(files[0]).toBe('0001_initial_schema.sql');
    expect(files).toContain('0008_grant_priority_seq.sql');
    // Filename order IS apply order — the list must already be sorted.
    expect(files).toStrictEqual(sorted(files));
  });
});
