#!/usr/bin/env bash
# Replays the race the unique-number rule guards against, in a throwaway git repo: two branches
# cut from the same main each take migration 0003, each lints green on its own, and the tree that
# merging would produce (what CI's pull_request checkout is) fails.
set -eu

REPO=$(git rev-parse --show-toplevel)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

g() { git -C "$WORK/repo" -c user.name=demo -c user.email=demo@example.com -c commit.gpgsign=false "$@"; }

# Lint the demo repo's migrations through the package script. npm's own failure banner names a
# timestamped log file, so stderr is dropped; the temp path is replaced so the output is stable.
lint() {
  status=0
  (cd "$REPO" && npm run -s lint:migrations -w tools/migration-lint -- "$WORK/repo/migrations") \
    >"$WORK/lint.out" 2>/dev/null || status=$?
  sed -E 's#^(\.\./)+.*/migrations$#<the tree being linted>/migrations#' "$WORK/lint.out" | sed '/^$/d'
  echo "  -> exit $status"
}

add_migration() { printf 'select 1;\n' >"$WORK/repo/migrations/$1"; g add -A; g commit -qm "$1"; }

git init -q -b main "$WORK/repo"
mkdir "$WORK/repo/migrations"
for name in 0001_init.sql 0002_items.sql; do add_migration "$name"; done

g switch -q -c alf-color
add_migration 0003_add_color.sql
g switch -q main
g switch -q -c alf-tags
add_migration 0003_add_tags.sql

echo "== branch alf-color, on its own (what its pre-commit hook lints)"
g switch -q alf-color
lint
echo "== branch alf-tags, on its own (what its pre-commit hook lints)"
g switch -q alf-tags
lint

echo "== alf-color merges to main first; alf-tags merged with main is what CI checks out"
g switch -q main
g merge -q --ff-only alf-color
g switch -q alf-tags
g merge -q --no-edit main
lint
