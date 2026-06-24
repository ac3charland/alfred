#!/usr/bin/env bash
# Reproduce — and prove the fix for — the `permission denied for sequence
# code_priority_seq` 500 that hit every code-story insert (create_code_story /
# enter_code_module). It stands up a hermetic, throwaway PostgreSQL cluster, creates
# the Supabase API roles, applies the real migrations exactly as production does
# (raw `psql -f`, in filename order, as the table owner), then runs create_code_story
# as the `authenticated` role BEFORE and AFTER migration 0008.
#
# This is the kind of real-Postgres check the JS mock (frontend/scripts/mock-supabase.mjs)
# structurally cannot perform: it never executes the migrations or enforces grants. See
# docs/specs / the supabase skill for the testing-gap discussion.
#
# Deterministic by construction (fresh cluster each run, fixed seed data), so it doubles
# as a showboat `verify` target. Requires PostgreSQL 16 server binaries on the host.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="$ROOT/database/migrations"
PGBIN="$(dirname "$(command -v initdb || echo /usr/lib/postgresql/16/bin/initdb)")"

WORK="$(mktemp -d)"
PGDATA="$WORK/data"
SOCK="$WORK/sock"
mkdir -p "$PGDATA" "$SOCK"

# initdb/postgres refuse to run as root; run the server as the `postgres` system user
# when we're root, otherwise as the current user.
if [ "$(id -u)" = "0" ]; then
  chown -R postgres:postgres "$WORK"
  run() { su postgres -s /bin/bash -c "$1"; }
else
  run() { bash -c "$1"; }
fi

cleanup() {
  run "$PGBIN/pg_ctl -D '$PGDATA' stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

run "$PGBIN/initdb -D '$PGDATA' -U postgres --auth=trust" >/dev/null 2>&1
run "$PGBIN/pg_ctl -D '$PGDATA' -o '-k $SOCK -p 5432' -l '$WORK/pg.log' -w start" >/dev/null 2>&1

PSQL() { run "psql -h '$SOCK' -p 5432 -U postgres -v ON_ERROR_STOP=1 -q $*"; }

# Supabase predefined roles (auto-created on a real project; absent on plain PG).
PSQL "-c \"create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;\"" >/dev/null 2>&1

# Apply the real migrations the way prod does (raw psql, filename order). 0003/0006 are
# unrelated to this path (realtime publication / recurring tasks) and are skipped here.
for f in 0001_initial_schema 0002_software_factory 0004_create_code_story 0005_story_priority; do
  PSQL "-f '$MIG/$f.sql'" >/dev/null 2>&1
done

# Seed the project + epic the modal creates a bug under (ALF-4 "Bug Fixes").
PSQL "-c \"insert into projects (id, key, name, repo_owner, repo_name) values ('11111111-1111-1111-1111-111111111111','ALF','Alfred','ac3charland','alfred'); insert into epics (id, project_id, name, ref_number, ref) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Bug Fixes',4,'ALF-4');\"" >/dev/null 2>&1

CALL="select ref, factory_state, priority from create_code_story('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Don''t count completed stories in epic rankings');"

echo "BEFORE 0008 — create_code_story as authenticated:"
# Expected to fail; capture just the ERROR line so output is stable (the insert errors, so
# psql exits non-zero — `|| true` keeps pipefail from masking the grep result).
before="$(run "psql -h '$SOCK' -p 5432 -U postgres -q -c \"set role authenticated; $CALL\"" 2>&1 || true)"
printf '%s\n' "$before" | grep -E '^ERROR:' || echo "  (no error — unexpected)"

PSQL "-f '$MIG/0008_grant_priority_seq.sql'" >/dev/null 2>&1

echo
echo "AFTER 0008 — create_code_story as authenticated:"
after="$(run "psql -h '$SOCK' -p 5432 -U postgres -q -A -F' | ' -c \"set role authenticated; $CALL\"" 2>&1)"
printf '%s\n' "$after" | grep -E '^(ref|ALF-)'
