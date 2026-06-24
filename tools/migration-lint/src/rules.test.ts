import { countBySeverity, lintMigrations } from './lint.ts';
import { type MigrationsContext, parseSql } from './migrations.ts';
import { rules } from './rules.ts';

function makeMigrations(overrides: Partial<MigrationsContext> = {}): MigrationsContext {
  return {
    migrationsDir: '/repo/database/migrations',
    displayPath: 'database/migrations',
    createdSequences: [],
    sequenceUsageGrants: new Map(),
    ...overrides,
  };
}

/**
 * Build a {@link MigrationsContext} from inline SQL strings (one per "file"), running the
 * real {@link parseSql} over each so tests exercise the parser end-to-end without touching disk.
 */
function migrationsFromSql(files: Record<string, string>): MigrationsContext {
  const createdSequences: { name: string; file: string }[] = [];
  const sequenceUsageGrants = new Map<string, Set<string>>();
  for (const [file, sql] of Object.entries(files)) {
    const parsed = parseSql(sql);
    for (const name of parsed.createdSequences) createdSequences.push({ name, file });
    for (const [sequence, roles] of parsed.usageGrants) {
      const existing = sequenceUsageGrants.get(sequence) ?? new Set<string>();
      for (const role of roles) existing.add(role);
      sequenceUsageGrants.set(sequence, existing);
    }
  }
  return makeMigrations({ createdSequences, sequenceUsageGrants });
}

function findingsFor(
  rule: string,
  migrations: MigrationsContext,
): ReturnType<typeof lintMigrations> {
  return lintMigrations(migrations).filter((finding) => finding.rule === rule);
}

describe('sequence-grant', () => {
  it('passes when there are no created sequences', () => {
    expect(findingsFor('sequence-grant', makeMigrations())).toHaveLength(0);
  });

  it('errors with all three roles missing when a sequence has no grant', () => {
    const [finding] = findingsFor(
      'sequence-grant',
      migrationsFromSql({ '0001.sql': 'create sequence foo_seq;' }),
    );
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('foo_seq');
    expect(finding?.message).toContain('0001.sql');
    expect(finding?.message).toContain('anon, authenticated, service_role');
    expect(finding?.message).toContain(
      'grant usage on sequence foo_seq to anon, authenticated, service_role;',
    );
  });

  it('passes when all three roles are granted USAGE (across files)', () => {
    expect(
      findingsFor(
        'sequence-grant',
        migrationsFromSql({
          '0001.sql': 'create sequence foo_seq;',
          '0002.sql': 'grant usage on sequence foo_seq to anon, authenticated, service_role;',
        }),
      ),
    ).toHaveLength(0);
  });

  it('reports only the roles still missing after a partial grant', () => {
    const [finding] = findingsFor(
      'sequence-grant',
      migrationsFromSql({
        '0001.sql': 'create sequence foo_seq;',
        '0002.sql': 'grant usage on sequence public."foo_seq" to authenticated;',
      }),
    );
    expect(finding?.severity).toBe('error');
    // The missing-roles list (before the period) names only the two ungranted roles —
    // `authenticated` was granted, so it is absent here even though the Fix line lists all three.
    expect(finding?.message).toContain('missing USAGE grants for: anon, service_role.');
  });

  it('treats an ALL grant as covering USAGE for every role', () => {
    expect(
      findingsFor(
        'sequence-grant',
        migrationsFromSql({
          '0001.sql': 'create sequence foo_seq;',
          '0002.sql': 'grant all on sequence foo_seq to anon, authenticated, service_role;',
        }),
      ),
    ).toHaveLength(0);
  });

  it('reports one finding per under-granted sequence', () => {
    expect(
      findingsFor(
        'sequence-grant',
        migrationsFromSql({
          '0001.sql': 'create sequence a_seq; create sequence b_seq;',
          '0002.sql': 'grant usage on sequence a_seq to anon, authenticated, service_role;',
        }),
      ),
    ).toHaveLength(1);
  });
});

describe('lint orchestration', () => {
  it('registers the one rule', () => {
    expect(rules.map((rule) => rule.name)).toEqual(['sequence-grant']);
  });

  it('tallies errors and warnings', () => {
    const findings = lintMigrations(migrationsFromSql({ '0001.sql': 'create sequence foo_seq;' }));
    expect(countBySeverity(findings)).toEqual({ errors: 1, warnings: 0 });
  });
});
