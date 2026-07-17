import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  MIGRATIONS_DIR,
  formatAppliedLine,
  migrationFiles,
  parseEnvValue,
  recordApplied,
  resolveMigration,
  sorted,
} from './migrate.ts';

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

describe('resolveMigration', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'alfred-resolve-'));
  beforeAll(() => {
    writeFileSync(path.join(dir, '0001_initial_schema.sql'), '');
    writeFileSync(path.join(dir, '0010_task_priority.sql'), '');
    writeFileSync(path.join(dir, '0011_task_items_view_columns.sql'), '');
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a 4-digit prefix to its single file', () => {
    expect(path.basename(resolveMigration('0011', dir))).toBe('0011_task_items_view_columns.sql');
  });

  it('zero-pads a bare number to the NNNN prefix', () => {
    expect(path.basename(resolveMigration('11', dir))).toBe('0011_task_items_view_columns.sql');
  });

  it('accepts a full filename', () => {
    expect(path.basename(resolveMigration('0010_task_priority.sql', dir))).toBe(
      '0010_task_priority.sql',
    );
  });

  it('throws when nothing matches', () => {
    expect(() => resolveMigration('9999', dir)).toThrow(/no migration matches/);
  });

  it('throws when the selector is ambiguous', () => {
    writeFileSync(path.join(dir, '0011_extra.sql'), '');
    try {
      expect(() => resolveMigration('0011', dir)).toThrow(/ambiguous/);
    } finally {
      rmSync(path.join(dir, '0011_extra.sql'), { force: true });
    }
  });
});

describe('parseEnvValue', () => {
  it('reads a quoted value and ignores comments and other keys', () => {
    const body = ['# a comment', 'OTHER=nope', 'DATABASE_URL="postgres://u@h:5432/db"', ''].join(
      '\n',
    );
    expect(parseEnvValue(body, 'DATABASE_URL')).toBe('postgres://u@h:5432/db');
  });

  it('tolerates a leading export and unquoted values', () => {
    expect(parseEnvValue('export DATABASE_URL=postgres://x', 'DATABASE_URL')).toBe('postgres://x');
  });

  it('returns undefined for a missing key', () => {
    expect(parseEnvValue('FOO=bar', 'DATABASE_URL')).toBeUndefined();
  });
});

describe('formatAppliedLine', () => {
  it('emits an ISO timestamp, host, and basename, tab-separated and newline-terminated', () => {
    const line = formatAppliedLine(
      new Date('2026-07-17T12:00:00.000Z'),
      'db.example.supabase.co',
      '/repo/database/migrations/0017_grant_v_code_stories.sql',
    );
    expect(line).toBe(
      '2026-07-17T12:00:00.000Z\tdb.example.supabase.co\t0017_grant_v_code_stories.sql\n',
    );
  });
});

describe('recordApplied', () => {
  it('appends a ledger line, preserving prior entries', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'alfred-ledger-'));
    const logPath = path.join(dir, 'migrations-applied.log');
    try {
      writeFileSync(logPath, '# header\n');
      recordApplied(new Date('2026-07-17T12:00:00.000Z'), 'host-a', '0016_x.sql', logPath);
      recordApplied(new Date('2026-07-18T09:30:00.000Z'), 'host-a', '0017_y.sql', logPath);
      expect(readFileSync(logPath, 'utf8')).toBe(
        '# header\n' +
          '2026-07-17T12:00:00.000Z\thost-a\t0016_x.sql\n' +
          '2026-07-18T09:30:00.000Z\thost-a\t0017_y.sql\n',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
