---
branch: claude/committed-log-necessity-6003r3
---

# Remove the manual migrate CLI and its committed ledger

*2026-08-08T14:32:34.670Z*

The migrate CI job (.github/workflows/migrate.yml, running database/src/deploy.ts on every push to main) now applies every pending migration to both live instances automatically, keyed off each database's own schema_migrations ledger. The committed database/migrations-applied.log paper trail — and the npm run migrate CLI that appended to it by hand — are gone; manual migration is no longer a supported workflow.

The manual applier and its ledger are gone from the tree:

```bash

test -f database/src/apply.ts && echo "database/src/apply.ts: still present" || echo "database/src/apply.ts: removed"
test -f database/migrations-applied.log && echo "database/migrations-applied.log: still present" || echo "database/migrations-applied.log: removed"
grep -q "\"migrate\":" database/package.json && echo "package.json migrate script: still present" || echo "package.json migrate script: removed"
```

```output
database/src/apply.ts: removed
database/migrations-applied.log: removed
package.json migrate script: removed
```

The database package's fast checks (typecheck, lint, unit tests) stay green with the removal:

```bash

npm run check:fast -w database > /tmp/db-check-fast.log 2>&1
code=$?
grep -E "Test Suites:|Tests:" /tmp/db-check-fast.log
echo "exit code: $code"
```

```output
Test Suites: 4 passed, 4 total
Tests:       52 passed, 52 total
exit code: 0
```

```bash

npm run check:slow -w database > /tmp/db-check-slow.log 2>&1
code=$?
grep -E "^✓ (deploy|an explicit|a migration and its ledger|the migration ledger)|db-integration:" /tmp/db-check-slow.log
echo "exit code: $code"
```

```output
✓ deploy applies every migration to an empty database, then is a no-op — 26 applied, second run applied 0
✓ deploy REFUSES to guess the history of a database that has schema but no ledger — refused, and wrote nothing
✓ an explicit --baseline adopts a database at its verified point, then applies the rest — adopted 24 at 0024_folder_sort_order.sql, applied 2, then a clean no-op
✓ a migration and its ledger row land together, or not at all — rolled back on a failed statement AND on a failed ledger write
✓ the migration ledger is not readable by the PostgREST API roles — anon and authenticated are both denied
db-integration: 38/38 passed.
exit code: 0
```

That leaves exactly one path to a live database: merge to main, and .github/workflows/migrate.yml applies whatever's pending to both instances.
