---
branch: claude/alfred-code-stories-500-7dxwdo
---

# Code stories 500 — restore the v_code_stories SELECT grant (ALF-124)

*2026-07-17T15:36:24.741Z*

The Code view 500'd on every device: GET /api/code reads the `v_code_stories` view as the browser's `authenticated` role, but migration 0014 dropped and recreated that view to retype `priority` and never re-granted SELECT. `drop view` drops the view's privileges; the bare `create view` that follows starts with none. So the read raised `permission denied for view v_code_stories` (Postgres 42501), which the route maps to 500. Migration 0017 re-grants SELECT; a new migration-lint `view-grant` rule catches the whole class at commit time.

**1. The committed migrations are clean — 0017 restores the grant that 0014 dropped.**

```bash
npm run lint:migrations -w tools/migration-lint 2>/dev/null | tail -1
```

```output
migration-lint: 0 error(s), 0 warning(s).
```

**2. The new `view-grant` rule catches the bug.** A fixture that drops and bare-recreates a view without re-granting SELECT — exactly the 0014 shape — is flagged. A grant from *before* the recreate does not count, because Postgres dropped it.

```bash
d=$(mktemp -d)
printf "create view v_x as select 1;\ngrant select on v_x to anon, authenticated, service_role;\n" > "$d/0001_a.sql"
printf "drop view v_x;\ncreate view v_x as select 2;\n" > "$d/0002_b.sql"
npm run lint:migrations -w tools/migration-lint -- "$d" 2>/dev/null | grep -oE "\[view-grant\] view v_x \(created in 0002_b.sql\) is missing SELECT grants for: [a-z_, ]+"
npm run lint:migrations -w tools/migration-lint -- "$d" 2>/dev/null | tail -1
rm -rf "$d"
```

```output
[view-grant] view v_x (created in 0002_b.sql) is missing SELECT grants for: anon, authenticated, service_role
migration-lint: 1 error(s), 0 warning(s).
```

**3. Re-granting SELECT after the recreate clears it** — the fix 0017 applies to the real view.

```bash
d=$(mktemp -d)
printf "create view v_x as select 1;\n" > "$d/0001_a.sql"
printf "drop view v_x;\ncreate view v_x as select 2;\ngrant select on v_x to anon, authenticated, service_role;\n" > "$d/0002_b.sql"
npm run lint:migrations -w tools/migration-lint -- "$d" 2>/dev/null | tail -1
rm -rf "$d"
```

```output
migration-lint: 0 error(s), 0 warning(s).
```

**4. A committed apply-ledger gives a paper trail.** `npm run migrate` now appends one line per successful apply to `database/migrations-applied.log` (and reminds you to commit it), so drift like "0014 was never applied to prod" is answerable from the repo. This is the line it writes:

```bash
node --input-type=module -e "import { formatAppliedLine } from './database/src/migrate.ts'; process.stdout.write(formatAppliedLine(new Date('2026-07-17T12:00:00.000Z'), 'db.example.supabase.co', '0017_grant_v_code_stories.sql'));" 2>/dev/null
```

```output
2026-07-17T12:00:00.000Z	db.example.supabase.co	0017_grant_v_code_stories.sql
```
