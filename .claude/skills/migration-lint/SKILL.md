---
name: migration-lint
description: >
  Covers migration-lint, the static linter over database/migrations/*.sql that runs in the
  global check:fast (pre-commit). Use when running or interpreting
  migration-lint, fixing a sequence-grant or view-grant finding, adding or changing a rule, or
  wiring it into the build. Trigger on: "migration-lint", "lint the migrations", "sequence-grant",
  "view-grant", "permission denied for sequence", "permission denied for view", "missing grant",
  "add a migration-lint rule", or editing tools/migration-lint.
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

## The rules

| Rule | Fires when | Fix |
| --- | --- | --- |
| `sequence-grant` | a `create sequence X` has no `grant usage` (or `all`) on `X` to all of `anon`, `authenticated`, `service_role` anywhere in the migrations | add `grant usage on sequence X to anon, authenticated, service_role;` |
| `view-grant` | a bare `create view X` (NOT `create or replace`) has no `grant select` (or `all`) on `X` to all three roles **at or after** that create | add `grant select on X to anon, authenticated, service_role;` in the same migration |

**`sequence-grant` aggregates grants across all files** (order-insensitive) — a grant in a
**later** migration satisfies an earlier `create sequence` (that's how `0008` clears `0005`).
Why all three roles: the insert RPCs are `security invoker`, so a column default's `nextval('X')`
runs as the *calling* role and needs USAGE.

**`view-grant` is order-aware**, because `drop view` (and the bare `create view` that follows)
*drops* the view's privileges — a grant from **before** the recreate no longer applies, so only a
re-grant at or after the last bare create counts. `create or replace view` preserves grants and is
ignored. This is the view analogue of the sequence 500: a `security_invoker` view with no SELECT
grant fails every read with `permission denied for view X` → a 500 (the `0014`→`0017` `v_code_stories`
bug; see the `supabase` skill).

## Everyday gotchas

- **Comments / strings / function bodies can't false-match.** `stripNonCode` removes
  dollar-quoted blocks, block + line comments, and single-quoted literals before the regexes
  run, so a `create sequence` / `create view` mentioned in prose never counts. It is a **single
  left-to-right pass**, not independent `replaceAll`s: comments and string literals are mutually
  exclusive contexts, so stripping strings *before* comments let an apostrophe in a `--` prose
  comment (e.g. "the story's project") open a phantom string that swallowed the real SQL after it —
  silently blinding every rule to statements in between (it hid `0014`'s `create view`). Keep the
  scan single-pass.
- **Quoted, schema-qualified names normalize.** `public."Foo_Seq"`, `"foo_seq"`, and `foo_seq`
  all match the same sequence (`normalizeName` strips quotes/schema and lowercases).
- **Each grant is scoped to its own statement** (`[^;]+?`), so a prior `grant … on table …;`
  can't bleed into a sequence grant's match.

## Maintaining the tool

Standard rule-registry split mirroring `tools/demo-lint`: `src/migrations.ts` gathers the pure
`MigrationsContext` (created sequences + USAGE grants; created views + order-aware SELECT grants,
where a bare `create view` resets that view's grant set — parsed via `stripNonCode` / `parseSql`),
`src/rules.ts` holds the rule registry (add a `Rule` to the exported `rules` array to lint
something new), `src/lint.ts` runs them, `src/cli.ts` is the entry point. Same source
constraints as the rest of `tools/*` — explicit `.ts` import extensions, erasable syntax only,
no `process.exit()`, no `.sort()` (use the `sorted()` helper); see the `showboat` skill's
maintainer notes. Tests run under ts-jest ESM via the package's `check:fast`.
