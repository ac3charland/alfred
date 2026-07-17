import { lintMigrations } from './lint.ts';
import {
  DEFAULT_MIGRATIONS_DIR,
  gatherMigrations,
  normalizeName,
  parseSql,
  stripNonCode,
} from './migrations.ts';

describe('stripNonCode', () => {
  it('removes a line comment so its text never counts as code', () => {
    const stripped = stripNonCode('-- create sequence fake_seq\ncreate sequence real_seq;');
    expect(parseSql(stripped).createdSequences).toEqual(['real_seq']);
  });

  it('removes a block comment', () => {
    const stripped = stripNonCode('/* create sequence fake_seq; */ create sequence real_seq;');
    expect(parseSql(stripped).createdSequences).toEqual(['real_seq']);
  });

  it('removes a dollar-quoted function body', () => {
    const sql = `create or replace function f() returns void language plpgsql as $$
begin
  -- create sequence fake_seq inside a body must not count
  perform 1;
end; $$;
create sequence real_seq;`;
    expect(parseSql(stripNonCode(sql)).createdSequences).toEqual(['real_seq']);
  });

  it('neutralizes a single-quoted string literal so its text is not parsed', () => {
    const stripped = stripNonCode("select 'create sequence fake_seq'; create sequence real_seq;");
    expect(parseSql(stripped).createdSequences).toEqual(['real_seq']);
  });

  it('neutralizes a string that contains an escaped quote', () => {
    const stripped = stripNonCode("select 'it''s create sequence fake'; create sequence real_seq;");
    expect(parseSql(stripped).createdSequences).toEqual(['real_seq']);
  });

  it('does not let an apostrophe in a line comment open a phantom string that swallows real SQL', () => {
    // The ALF-124 detection miss: a `--` prose comment with an odd apostrophe count (here "story's")
    // must not be read as an unterminated string that eats the following statement. Line comments
    // are stripped in-context, so the create view after it is still seen.
    const stripped = stripNonCode("-- bump the story's rank\ncreate view v_x as select 1;");
    expect(parseSql(stripped).viewEvents.filter((event) => event.kind === 'create')).toEqual([
      { kind: 'create', name: 'v_x', roles: [], offset: expect.any(Number) as number },
    ]);
  });

  it('keeps a -- inside a string literal from being treated as a comment', () => {
    // The mirror hazard the single-pass scanner also gets right: `--` inside a string is data.
    const stripped = stripNonCode("select 'a -- b'; create sequence real_seq;");
    expect(parseSql(stripped).createdSequences).toEqual(['real_seq']);
  });
});

describe('normalizeName', () => {
  it('strips the schema and lowercases an unquoted name', () => {
    expect(normalizeName('public.Foo_Seq')).toBe('foo_seq');
  });

  it('strips surrounding double-quotes and the schema', () => {
    expect(normalizeName('public."Foo_Seq"')).toBe('foo_seq');
  });

  it('leaves a bare lowercase name unchanged', () => {
    expect(normalizeName('foo_seq')).toBe('foo_seq');
  });
});

describe('parseSql', () => {
  it('finds a created sequence', () => {
    expect(parseSql('create sequence foo_seq;').createdSequences).toEqual(['foo_seq']);
  });

  it('finds a created sequence with IF NOT EXISTS', () => {
    expect(parseSql('create sequence if not exists foo_seq;').createdSequences).toEqual([
      'foo_seq',
    ]);
  });

  it('records a USAGE grant for each role', () => {
    const { usageGrants } = parseSql(
      'grant usage on sequence foo_seq to anon, authenticated, service_role;',
    );
    expect(usageGrants.get('foo_seq')).toEqual(new Set(['anon', 'authenticated', 'service_role']));
  });

  it('treats an ALL grant as conferring USAGE', () => {
    const { usageGrants } = parseSql('grant all on sequence foo_seq to anon;');
    expect(usageGrants.get('foo_seq')).toEqual(new Set(['anon']));
  });

  it('treats ALL PRIVILEGES as conferring USAGE', () => {
    const { usageGrants } = parseSql('grant all privileges on sequence foo_seq to anon;');
    expect(usageGrants.get('foo_seq')).toEqual(new Set(['anon']));
  });

  it('ignores a grant that does not confer USAGE', () => {
    const { usageGrants } = parseSql('grant select on sequence foo_seq to anon;');
    expect(usageGrants.has('foo_seq')).toBe(false);
  });

  it('normalizes a quoted, schema-qualified sequence in a grant', () => {
    const { usageGrants } = parseSql('grant usage on sequence public."foo_seq" to authenticated;');
    expect(usageGrants.get('foo_seq')).toEqual(new Set(['authenticated']));
  });

  it('records a bare create view as a create event', () => {
    const { viewEvents } = parseSql('create view v_x with (security_invoker = true) as select 1;');
    expect(viewEvents).toEqual([{ kind: 'create', name: 'v_x', roles: [], offset: 0 }]);
  });

  it('does not record a create-or-replace view as a create event', () => {
    const { viewEvents } = parseSql('create or replace view v_x as select 1;');
    expect(viewEvents.filter((event) => event.kind === 'create')).toEqual([]);
  });

  it('records a SELECT grant on a view, one grant event per listed object', () => {
    const { viewEvents } = parseSql('grant select on task_items, v_code_stories to authenticated;');
    const grants = viewEvents.filter((event) => event.kind === 'grant');
    expect(grants.map((event) => event.name)).toEqual(['task_items', 'v_code_stories']);
    expect(grants[0]?.roles).toEqual(['authenticated']);
  });

  it('does not treat a sequence grant as a view grant', () => {
    const { viewEvents } = parseSql('grant usage on sequence foo_seq to anon;');
    expect(viewEvents.filter((event) => event.kind === 'grant')).toEqual([]);
  });

  it('orders create and grant events by source offset', () => {
    const { viewEvents } = parseSql('create view v_x as select 1; grant select on v_x to anon;');
    expect(viewEvents.map((event) => event.kind)).toEqual(['create', 'grant']);
  });
});

describe('gatherMigrations against the real migrations', () => {
  it('returns no sequence-grant findings — the committed migrations all grant USAGE', () => {
    const migrations = gatherMigrations(DEFAULT_MIGRATIONS_DIR);
    const findings = lintMigrations(migrations).filter(
      (finding) => finding.rule === 'sequence-grant',
    );
    expect(findings).toEqual([]);
  });

  it('returns no view-grant findings — every recreated view re-grants SELECT (0017 fixes 0014)', () => {
    const migrations = gatherMigrations(DEFAULT_MIGRATIONS_DIR);
    const findings = lintMigrations(migrations).filter((finding) => finding.rule === 'view-grant');
    expect(findings).toEqual([]);
  });
});
