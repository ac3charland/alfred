import { countBySeverity, lintMigrations } from './lint.ts';
import { type MigrationsContext, parseSql } from './migrations.ts';
import { rules } from './rules.ts';

function makeMigrations(overrides: Partial<MigrationsContext> = {}): MigrationsContext {
  return {
    migrationsDir: '/repo/database/migrations',
    displayPath: 'database/migrations',
    createdSequences: [],
    sequenceUsageGrants: new Map(),
    createdViews: [],
    viewSelectGrants: new Map(),
    ...overrides,
  };
}

/**
 * Build a {@link MigrationsContext} from inline SQL strings (one per "file"), running the
 * real {@link parseSql} over each so tests exercise the parser end-to-end without touching disk.
 * Object insertion order stands in for filename order — the same order-aware view replay that
 * {@link gatherMigrations} performs, so a grant before a recreate is correctly discarded.
 */
function migrationsFromSql(files: Record<string, string>): MigrationsContext {
  const createdSequences: { name: string; file: string }[] = [];
  const sequenceUsageGrants = new Map<string, Set<string>>();
  const viewCreateFile = new Map<string, string>();
  const viewSelectGrants = new Map<string, Set<string>>();
  for (const [file, sql] of Object.entries(files)) {
    const parsed = parseSql(sql);
    for (const name of parsed.createdSequences) createdSequences.push({ name, file });
    for (const [sequence, roles] of parsed.usageGrants) {
      const existing = sequenceUsageGrants.get(sequence) ?? new Set<string>();
      for (const role of roles) existing.add(role);
      sequenceUsageGrants.set(sequence, existing);
    }
    for (const event of parsed.viewEvents) {
      if (event.kind === 'create') {
        viewCreateFile.set(event.name, file);
        viewSelectGrants.set(event.name, new Set());
      } else {
        const existing = viewSelectGrants.get(event.name) ?? new Set<string>();
        for (const role of event.roles) existing.add(role);
        viewSelectGrants.set(event.name, existing);
      }
    }
  }
  const createdViews = [...viewCreateFile].map(([name, file]) => ({ name, file }));
  return makeMigrations({ createdSequences, sequenceUsageGrants, createdViews, viewSelectGrants });
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

describe('view-grant', () => {
  it('passes when there are no created views', () => {
    expect(findingsFor('view-grant', makeMigrations())).toHaveLength(0);
  });

  it('passes when a bare create view is granted SELECT to all three roles in the same file', () => {
    expect(
      findingsFor(
        'view-grant',
        migrationsFromSql({
          '0001.sql':
            'create view v_x as select 1; grant select on v_x to anon, authenticated, service_role;',
        }),
      ),
    ).toHaveLength(0);
  });

  it('errors when a bare create view is never granted SELECT', () => {
    const [finding] = findingsFor(
      'view-grant',
      migrationsFromSql({ '0001.sql': 'create view v_x as select 1;' }),
    );
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('v_x');
    expect(finding?.message).toContain('0001.sql');
    expect(finding?.message).toContain('permission denied for view v_x');
    expect(finding?.message).toContain('grant select on v_x to anon, authenticated, service_role;');
  });

  it('does NOT count a grant from before a drop/recreate — Postgres dropped it (the ALF-124 bug)', () => {
    // 0001 creates and grants; 0002 drops and bare-recreates without re-granting. The recreated
    // view has no privileges even though a grant appears earlier in the migration chain.
    const [finding] = findingsFor(
      'view-grant',
      migrationsFromSql({
        '0001.sql':
          'create view v_x as select 1; grant select on v_x to anon, authenticated, service_role;',
        '0002.sql': 'drop view v_x; create view v_x as select 2;',
      }),
    );
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('v_x');
    expect(finding?.message).toContain('0002.sql');
    expect(finding?.message).toContain('anon, authenticated, service_role');
  });

  it('passes when a drop/recreate re-grants SELECT to all three roles', () => {
    expect(
      findingsFor(
        'view-grant',
        migrationsFromSql({
          '0001.sql':
            'create view v_x as select 1; grant select on v_x to anon, authenticated, service_role;',
          '0002.sql':
            'drop view v_x; create view v_x as select 2; grant select on v_x to anon, authenticated, service_role;',
        }),
      ),
    ).toHaveLength(0);
  });

  it('ignores a create or replace view (it preserves the existing grants)', () => {
    // Only a bare `create view` resets privileges; a replace keeps them, so the original grant holds.
    expect(
      findingsFor(
        'view-grant',
        migrationsFromSql({
          '0001.sql':
            'create view v_x as select 1; grant select on v_x to anon, authenticated, service_role;',
          '0002.sql': 'create or replace view v_x as select 2;',
        }),
      ),
    ).toHaveLength(0);
  });

  it('reports only the roles still missing after a partial grant', () => {
    const [finding] = findingsFor(
      'view-grant',
      migrationsFromSql({
        '0001.sql': 'create view v_x as select 1; grant select on v_x to authenticated;',
      }),
    );
    expect(finding?.message).toContain('missing SELECT grants for: anon, service_role.');
  });

  it('treats an ALL grant as covering SELECT for every role', () => {
    expect(
      findingsFor(
        'view-grant',
        migrationsFromSql({
          '0001.sql':
            'create view v_x as select 1; grant all on v_x to anon, authenticated, service_role;',
        }),
      ),
    ).toHaveLength(0);
  });
});

describe('lint orchestration', () => {
  it('registers the rules', () => {
    expect(rules.map((rule) => rule.name)).toEqual(['sequence-grant', 'view-grant']);
  });

  it('tallies errors and warnings', () => {
    const findings = lintMigrations(migrationsFromSql({ '0001.sql': 'create sequence foo_seq;' }));
    expect(countBySeverity(findings)).toEqual({ errors: 1, warnings: 0 });
  });
});
