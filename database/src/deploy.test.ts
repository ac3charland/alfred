import { planMigrations, unknownApplied } from './deploy.ts';

const FILES = ['0001_a.sql', '0002_b.sql', '0003_c.sql', '0004_d.sql'];

describe('planMigrations', () => {
  it('applies every migration to a database with no app schema', () => {
    expect(planMigrations({ files: FILES, applied: [], hasAppSchema: false })).toStrictEqual({
      baseline: [],
      apply: FILES,
    });
  });

  it('refuses to guess for a database that has schema but no ledger', () => {
    // The failure this exists to prevent: Personal and Work were BOTH somewhere other than the
    // assumed point, so recording an assumed history would have marked real gaps as applied and
    // hidden them forever. Adoption is an explicit, operator-verified act.
    expect(() => planMigrations({ files: FILES, applied: [], hasAppSchema: true })).toThrow(
      /no migration ledger/,
    );
  });

  it('adopts a pre-ledger database at an explicitly supplied point', () => {
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

  it('never adopts once the ledger has rows, even when a baseline is passed', () => {
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

  it('throws when the supplied baseline is not in the file set', () => {
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
