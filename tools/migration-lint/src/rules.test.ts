import { countBySeverity, lintMigrations } from './lint.ts';
import { type MigrationsContext, parseSql } from './migrations.ts';
import { rules } from './rules.ts';

function makeMigrations(overrides: Partial<MigrationsContext> = {}): MigrationsContext {
  return {
    migrationsDir: '/repo/database/migrations',
    displayPath: 'database/migrations',
    migrationFiles: [],
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
  return makeMigrations({
    migrationFiles: Object.keys(files),
    createdSequences,
    sequenceUsageGrants,
    createdViews,
    viewSelectGrants,
  });
}

/** A migrations directory holding just these filenames (bodies are irrelevant to numbering). */
function migrationsNamed(...names: string[]): MigrationsContext {
  return makeMigrations({ migrationFiles: names });
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

describe('unique-number', () => {
  it('passes when there are no migrations', () => {
    expect(findingsFor('unique-number', makeMigrations())).toHaveLength(0);
  });

  it('passes when every number is used exactly once', () => {
    expect(
      findingsFor(
        'unique-number',
        migrationsNamed('0001_init.sql', '0002_items.sql', '0003_views.sql'),
      ),
    ).toHaveLength(0);
  });

  it('errors when two migrations share a number, naming both files', () => {
    // The race this rule exists for: two branches cut from the same main both took 0042.
    const [finding, ...rest] = findingsFor(
      'unique-number',
      migrationsNamed('0041_a.sql', '0042_add_color.sql', '0042_add_tags.sql'),
    );
    expect(rest).toHaveLength(0);
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('0042');
    expect(finding?.message).toContain('0042_add_color.sql');
    expect(finding?.message).toContain('0042_add_tags.sql');
  });

  it('tells the author to renumber everything their branch added, in order', () => {
    // Renaming only the colliding file can move it past a later migration of the same branch that
    // depends on it (0003_create -> 0005 would run after 0004_alter), so the advice is all of them.
    const [finding] = findingsFor(
      'unique-number',
      migrationsNamed(
        '0002_b.sql',
        '0003_main_other.sql',
        '0003_branch_create.sql',
        '0004_branch_alter.sql',
      ),
    );
    expect(finding?.message).toMatch(/renumber every migration your branch added/i);
    expect(finding?.message).toContain('keeping their');
    expect(finding?.message).toContain('origin/main');
  });

  it('says what to do when the clash is already on main, and never to rename an applied file', () => {
    const [finding] = findingsFor(
      'unique-number',
      migrationsNamed('0041_a.sql', '0042_add_color.sql', '0042_add_tags.sql'),
    );
    expect(finding?.message).toContain('added neither');
    expect(finding?.message).toContain('migration-lint skill');
    // The ledger is keyed by filename: renaming an applied file re-runs it on the next deploy.
    expect(finding?.message).toMatch(/never rename a migration that is applied/i);
  });

  it('describes the order hazard accurately: filename order for a fresh database, merge order for production', () => {
    const [finding] = findingsFor('unique-number', migrationsNamed('0001_a.sql', '0001_b.sql'));
    expect(finding?.message).toContain('production');
    expect(finding?.message).toContain('merged first');
    expect(finding?.message).not.toContain('alphabet');
  });

  it('compares numbers, not spellings — 42_x.sql and 0042_y.sql collide', () => {
    expect(findingsFor('unique-number', migrationsNamed('42_x.sql', '0042_y.sql'))).toHaveLength(1);
  });

  it('reports one finding per colliding number, and one file group per number', () => {
    const findings = findingsFor(
      'unique-number',
      migrationsNamed('0005_a.sql', '0005_b.sql', '0005_c.sql', '0006_d.sql', '0006_e.sql'),
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]?.message).toContain('0005_c.sql');
  });

  it('errors on a .sql file with no numeric prefix — the applier still runs it', () => {
    // migrationFiles() in the applier takes every *.sql, so a misnamed file is applied but can never
    // be checked for a clash. A leading space even sorts it before 0001.
    const findings = findingsFor(
      'unique-number',
      migrationsNamed('0001_a.sql', ' 0002_e.sql', 'V0002_c.sql', 'notes.sql'),
    );
    expect(findings).toHaveLength(3);
    for (const finding of findings) expect(finding.severity).toBe('error');
    expect(findings.map((finding) => finding.message).join('\n')).toContain('V0002_c.sql');
    expect(findings[0]?.message).toContain('must start with its number');
  });

  it('tolerates the legacy pairs already applied in production', () => {
    // Renaming any of these files would re-apply it, so every pair stays exactly as committed.
    expect(
      findingsFor(
        'unique-number',
        migrationsNamed(
          '0031_realtime_items.sql',
          '0031_respace_code_priority.sql',
          '0041_project_color.sql',
          '0041_reader_instapaper_source.sql',
          '0042_comm_reclassify_failed.sql',
          '0042_project_pr_ratio_exclusion.sql',
        ),
      ),
    ).toHaveLength(0);
  });

  it('still errors when a third file joins a legacy number', () => {
    const [finding] = findingsFor(
      'unique-number',
      migrationsNamed(
        '0031_realtime_items.sql',
        '0031_respace_code_priority.sql',
        '0031_something_new.sql',
      ),
    );
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('0031_something_new.sql');
  });

  it('still errors when a legacy file collides with a different file at its number', () => {
    expect(
      findingsFor('unique-number', migrationsNamed('0041_project_color.sql', '0041_other.sql')),
    ).toHaveLength(1);
  });
});

describe('lint orchestration', () => {
  it('registers the rules', () => {
    expect(rules.map((rule) => rule.name)).toEqual([
      'sequence-grant',
      'view-grant',
      'unique-number',
    ]);
  });

  it('tallies errors and warnings', () => {
    const findings = lintMigrations(migrationsFromSql({ '0001.sql': 'create sequence foo_seq;' }));
    expect(countBySeverity(findings)).toEqual({ errors: 1, warnings: 0 });
  });
});
