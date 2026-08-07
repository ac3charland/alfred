import path from 'node:path';

import { BASELINE_MIGRATION, planMigrations, unknownApplied } from './deploy.ts';
import { MIGRATIONS_DIR, migrationFiles } from './migrate.ts';

const FILES = ['0001_a.sql', '0002_b.sql', '0003_c.sql', '0004_d.sql'];

describe('BASELINE_MIGRATION', () => {
  it('names a migration that actually exists', () => {
    // The baseline is the hand-applied history the live databases already carry. If a rename
    // ever orphans it, the first deploy against a pre-ledger database would throw instead of
    // baselining — catch that here, in the cheap suite.
    const names = migrationFiles(MIGRATIONS_DIR).map((file) => path.basename(file));
    expect(names).toContain(BASELINE_MIGRATION);
  });
});

describe('planMigrations', () => {
  it('applies every migration to a database with no app schema', () => {
    expect(planMigrations({ files: FILES, applied: [], hasAppSchema: false })).toStrictEqual({
      baseline: [],
      apply: FILES,
    });
  });

  it('baselines a pre-ledger database through the baseline migration', () => {
    expect(
      planMigrations({
        files: FILES,
        applied: [],
        hasAppSchema: true,
        baseline: '0002_b.sql',
      }),
    ).toStrictEqual({
      baseline: ['0001_a.sql', '0002_b.sql'],
      apply: ['0003_c.sql', '0004_d.sql'],
    });
  });

  it('never baselines once the ledger has rows, even on a database with app schema', () => {
    expect(
      planMigrations({
        files: FILES,
        applied: ['0001_a.sql'],
        hasAppSchema: true,
        baseline: '0002_b.sql',
      }),
    ).toStrictEqual({ baseline: [], apply: ['0002_b.sql', '0003_c.sql', '0004_d.sql'] });
  });

  it('applies nothing when the ledger already records every migration', () => {
    expect(
      planMigrations({
        files: FILES,
        applied: ['0004_d.sql', '0003_c.sql', '0002_b.sql', '0001_a.sql'],
        hasAppSchema: true,
      }),
    ).toStrictEqual({ baseline: [], apply: [] });
  });

  it('returns pending migrations in file order, whatever order the ledger reports', () => {
    expect(
      planMigrations({
        files: FILES,
        applied: ['0003_c.sql', '0001_a.sql'],
        hasAppSchema: true,
      }).apply,
    ).toStrictEqual(['0002_b.sql', '0004_d.sql']);
  });

  it('throws when the baseline migration is not in the file set', () => {
    expect(() =>
      planMigrations({ files: FILES, applied: [], hasAppSchema: true, baseline: '0099_gone.sql' }),
    ).toThrow(/0099_gone\.sql/);
  });
});

describe('unknownApplied', () => {
  it('reports ledger rows with no matching migration file', () => {
    expect(unknownApplied(FILES, ['0001_a.sql', '0009_renamed.sql'])).toStrictEqual([
      '0009_renamed.sql',
    ]);
  });

  it('is empty when every ledger row matches a file', () => {
    expect(unknownApplied(FILES, ['0002_b.sql'])).toStrictEqual([]);
  });
});
