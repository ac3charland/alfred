---
branch: claude/alf-119-priority-navigation-0y2r6p
---

# Double-arrow top-of-project jump: the RPC PostgREST could not find (ALF-119)

*2026-07-16T21:18:43.418Z*

The Backlog's double-chevron "top/bottom of project" action was 500ing in production with: `Could not find the function public.move_code_priority_in_project(p_ref, p_to_top) in the schema cache`. That is PostgREST's "this RPC does not exist" error — the function ships in migration 0014 (ALF-110) but 0014 was never applied to the live database, so `code_items.priority` was still `bigint` and both of 0014's functions were absent. The app code, the route, and the integration tests were all correct; only the deploy was missing.

Fix: apply migration 0014, then migration 0015 re-asserts the RPC idempotently (`create or replace` + grants) and runs `notify pgrst, 'reload schema'` so PostgREST picks the function up immediately. Below, a throwaway Postgres gets EVERY migration applied exactly as production does, then we invoke the RPC as the `authenticated` role — the same call the double-up chevron makes — to show the project-scoped jump actually happening.

```bash
node -e "$(cat <<'JS'
void (async () => {
  const { startCluster } = await import('./database/src/cluster.ts');
  const { applyMigrations, bootstrapSupabase } = await import('./database/src/migrate.ts');
  const pg = (await import('pg')).default;
  const cluster = await startCluster();
  const client = new pg.Client({ host: cluster.host, port: cluster.port, user: cluster.user, database: cluster.database });
  try {
    await client.connect();
    await bootstrapSupabase(client);
    await applyMigrations(client);   // every migration, in order, exactly as production
    await client.query(`insert into projects (id,key,name,repo_owner,repo_name) values ('11111111-1111-1111-1111-111111111111','ALF','Alfred','ac3charland','alfred'),('55555555-5555-5555-5555-555555555555','OTH','Other','ac3charland','other')`);
    await client.query(`insert into epics (id,project_id,name,ref_number,ref) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','E',1,'ALF-1'),('66666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555','E',1,'OTH-1')`);
    const mk = async (proj, epic, title) => {
      await client.query('set role authenticated');
      try { await client.query('select create_code_story(\$1,\$2,\$3)', [proj, epic, title]); }
      finally { await client.query('reset role'); }
    };
    await mk('55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666','Other top story');
    await mk('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Alfred story one');
    await mk('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Alfred story two');
    await mk('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Alfred story three');
    // Arrange a deterministic board: OTH-1 best overall (-10); ALF-1/2/3 stacked below it.
    await client.query(`update code_items set priority=-10 where ref='OTH-1'`);
    await client.query(`update code_items set priority=0   where ref='ALF-1'`);
    await client.query(`update code_items set priority=10  where ref='ALF-2'`);
    await client.query(`update code_items set priority=20  where ref='ALF-3'`);
    const board = async () => (await client.query(`select ref, priority from code_items order by priority`)).rows.map((r) => r.ref + '=' + r.priority).join('  ');
    console.log('before:  ' + (await board()));
    // The exact call the Backlog double-up chevron makes: ALF-3 (bottom of its project) to the top of ITS project.
    await client.query('set role authenticated');
    try { await client.query('select move_code_priority_in_project(\$1,\$2)', ['ALF-3', true]); }
    finally { await client.query('reset role'); }
    console.log('after:   ' + (await board()));
    console.log('=> ALF-3 tops its project (midpoint -5, above ALF-1/2) but stays below OTH-1: no cross-project leapfrog.');
  } finally { await client.end(); cluster.stop(); }
})();
JS
)" 2>/dev/null
```

```output
before:  OTH-1=-10  ALF-1=0  ALF-2=10  ALF-3=20
after:   OTH-1=-10  ALF-3=-5  ALF-1=0  ALF-2=10
=> ALF-3 tops its project (midpoint -5, above ALF-1/2) but stays below OTH-1: no cross-project leapfrog.
```
