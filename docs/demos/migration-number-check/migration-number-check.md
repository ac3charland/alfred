---
branch: claude/ci-check-db-migrations-7dnox9
---

# CI check: no two migrations may share a number

*2026-09-30T03:02:53.377Z*

Two branches cut from the same `main` each take the next migration number. Each passes its own checks, both merge, and `main` holds two `NNNN_*.sql` files that the applier runs in alphabetical order. The new `unique-number` rule in `migration-lint` fails that tree; it runs in `check:fast` and, alone via `--rule unique-number`, in the new `Migration numbers` CI workflow.

This replays the race in a throwaway git repo: each branch is green alone (what the pre-commit hook sees), and the tree CI checks out once the sibling has merged is red.

```bash
bash docs/demos/migration-number-check/race.sh
```

```output
== branch alf-color, on its own (what its pre-commit hook lints)
migration-lint: 0 error(s), 0 warning(s).
  -> exit 0
== branch alf-tags, on its own (what its pre-commit hook lints)
migration-lint: 0 error(s), 0 warning(s).
  -> exit 0
== alf-color merges to main first; alf-tags merged with main is what CI checks out
<the tree being linted>/migrations
  ✗ error [unique-number] migration number 0003 is used by 2 files: 0003_add_color.sql, 0003_add_tags.sql. Migrations apply in filename order, so a shared number leaves their relative order to the alphabet — usually two branches cut from the same main that each took the next number. Fix: rename the file your branch added (the one not on main — see git diff --name-status origin/main -- database/migrations) to the next free number, 0004_<name>.sql. Never rename a migration that is already on main: it is applied, and the ledger is keyed by filename, so the new name would run again.
migration-lint: 1 error(s), 0 warning(s).
  -> exit 1
```

The real migrations directory passes. `main` already carries two shared numbers, `0031` and `0041`. The applier ledger is keyed by filename, so renaming either file would make production run it again; both pairs are grandfathered by exact filename.

```bash
ls database/migrations | grep -E '^00(31|41)_'; npm run -s lint:migrations -w tools/migration-lint; echo "exit: $?"
```

```output
0031_realtime_items.sql
0031_respace_code_priority.sql
0041_project_color.sql
0041_reader_instapaper_source.sql

migration-lint: 0 error(s), 0 warning(s).
exit: 0
```

The grandfathering is by filename, not by number: a third file arriving at a legacy number still fails.

```bash
T=$(mktemp -d); mkdir "$T/migrations"; cp database/migrations/*.sql "$T/migrations"; touch "$T/migrations/0031_something_new.sql"; npm run -s lint:migrations -w tools/migration-lint -- "$T/migrations" > "$T/out" 2>/dev/null; echo "exit: $?"; sed -E "s#^(\.\./)+.*/migrations\$#<copy of database/migrations>#" "$T/out" | cut -c1-150; rm -rf "$T"
```

```output
exit: 1

<copy of database/migrations>
  ✗ error [unique-number] migration number 0031 is used by 3 files: 0031_realtime_items.sql, 0031_respace_code_priority.sql, 0031_something_new.sql.

migration-lint: 1 error(s), 0 warning(s).
```

`--rule <name>` scopes a run to the named rules. The CI job uses it so its failure means one thing; `check:fast` keeps running them all. Here one directory has an ungranted sequence (a `sequence-grant` violation) and unique numbers.

```bash
T=$(mktemp -d); printf "create sequence foo_seq;\n" > "$T/0001_seq.sql"; npm run -s lint:migrations -w tools/migration-lint -- "$T" >/dev/null 2>&1; echo "all rules: exit $?"; npm run -s lint:migrations -w tools/migration-lint -- --rule unique-number "$T" 2>/dev/null; echo "--rule unique-number: exit $?"; rm -rf "$T"
```

```output
all rules: exit 1

migration-lint: 0 error(s), 0 warning(s).
--rule unique-number: exit 0
```

The CI job needs no `npm ci`: the linter is dependency-free Node, so `npm run -w` works from a checkout with no `node_modules`. This runs the exact command the job runs, from a clean copy of the tracked files.

```bash
R=$(mktemp -d); git ls-files -z | tar --null -T - -cf - | tar -xf - -C "$R"; cd "$R"; test -d node_modules && echo "node_modules: present" || echo "node_modules: absent"; npm run -s lint:migrations -w tools/migration-lint -- --rule unique-number; echo "exit: $?"; cd /; rm -rf "$R"
```

```output
node_modules: absent

migration-lint: 0 error(s), 0 warning(s).
exit: 0
```

The workflow: it runs on `pull_request` (checked out as the PR merged into `main`) and `merge_group`, is not `paths:`-filtered (a skipped required check never reports), and installs nothing.

```bash
sed -n '/^on:/,$p' .github/workflows/migration-numbers.yml | grep -v '^ *#' | grep -v '^$'
```

```output
on:
  pull_request:
  merge_group:
permissions:
  contents: read
jobs:
  unique-numbers:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
      - name: Check migration numbers are unique
        run: npm run lint:migrations -w tools/migration-lint -- --rule unique-number
```
