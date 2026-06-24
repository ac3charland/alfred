---
name: migration-lint
description: >
  Covers migration-lint, the static linter over database/migrations/*.sql that runs in the
  global check:fast (pre-commit). Its sequence-grant rule fails the build when a created
  sequence has no USAGE grant to anon/authenticated/service_role — the latent "permission
  denied for sequence" 500. Use when running or interpreting migration-lint, fixing a
  sequence-grant finding, adding a rule, or wiring it into the build. Trigger on:
  "migration-lint", "lint the migrations", "sequence-grant", "permission denied for sequence",
  "missing grant on sequence", "add a migration-lint rule", or editing tools/migration-lint.
---

# migration-lint — lint the SQL migrations

## What it is and why

`tools/migration-lint` is a small, self-contained TypeScript CLI that statically checks
`database/migrations/*.sql`. Migrations are applied with raw `psql` (not `supabase db push`),
which doesn't auto-grant new objects to the API roles — so a `create sequence` whose USAGE
grant is forgotten is a latent 500 (`permission denied for sequence`, shipped once as the
0005→0008 bug). This linter catches that class at commit time, cheaply, with no database.

It runs in the repo's **`check:fast`** gate (pre-commit), wired into the **root** `check:fast`
ahead of the workspace fan-out (mirroring `skill-lint`) — static and fast, relevant on every
commit. The deeper, real-Postgres counterpart is the `database` integration suite
(`check:slow`); see the `supabase` and `backpressure` skills.

## Running it

Always through the package script, never the binary:

```bash
npm run lint:migrations -w tools/migration-lint            # lint database/migrations
npm run lint:migrations -w tools/migration-lint -- <dir>   # lint a different dir (fixtures/tests)
```

## The rule

| Rule | Fires when | Fix |
| --- | --- | --- |
| `sequence-grant` | a `create sequence X` has no `grant usage` (or `all`) on `X` to all of `anon`, `authenticated`, `service_role` anywhere in the migrations | add `grant usage on sequence X to anon, authenticated, service_role;` |

A grant in a **later** migration satisfies an earlier `create sequence` — grants are
aggregated across files, mirroring how Postgres applies the set (that's how `0008`'s grant
clears `0005`'s sequence). Why all three roles: the insert RPCs are `security invoker`, so a
column default's `nextval('X')` runs as the *calling* role and needs USAGE; the project grants
every object to all three (RLS still gates rows), so the rule requires the same.

## Everyday gotchas

- **Comments / strings / function bodies can't false-match.** `stripNonCode` removes
  dollar-quoted blocks, block + line comments, and single-quoted literals before the regexes
  run, so a `create sequence` mentioned in prose never counts.
- **Quoted, schema-qualified names normalize.** `public."Foo_Seq"`, `"foo_seq"`, and `foo_seq`
  all match the same sequence (`normalizeName` strips quotes/schema and lowercases).
- **Each grant is scoped to its own statement** (`[^;]+?`), so a prior `grant … on table …;`
  can't bleed into a sequence grant's match.

## Maintaining the tool

Standard rule-registry split mirroring `tools/demo-lint`: `src/migrations.ts` gathers the pure
`MigrationsContext` (created sequences + USAGE grants, parsed via `stripNonCode` / `parseSql`),
`src/rules.ts` holds the rule registry (add a `Rule` to the exported `rules` array to lint
something new), `src/lint.ts` runs them, `src/cli.ts` is the entry point. Same source
constraints as the rest of `tools/*` — explicit `.ts` import extensions, erasable syntax only,
no `process.exit()`, no `.sort()` (use the `sorted()` helper); see the `showboat` skill's
maintainer notes. Tests run under ts-jest ESM via the package's `check:fast`.
