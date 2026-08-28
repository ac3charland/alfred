---
branch: claude/skip-check-slow-spec-pushes-q1c3kj
---

# check:slow skips the package suites on a docs-only branch

*2026-08-28T14:45:04.615Z*

ALF-176: a spec- or demo-only push used to pay the full `check:slow` tier — Storybook image snapshots, Playwright E2E, and the database integration suite — to prove that markdown hadn't broken them. The root tier's workspace fan-out is now wrapped by `tools/check-scope`, which diffs the branch against the trunk merge-base and skips the wrapped command when every changed path lives under `docs/`.

Here is the wiring in the root `package.json` — `demo-lint` deliberately stays **ahead** of the wrapper, since a docs-only push is exactly when it has something to say:

```bash
grep -n "check:slow" package.json
```

```output
17:    "check": "npm run check:fast && npm run check:slow",
19:    "check:slow": "npm run lint:demos -w tools/demo-lint && node tools/check-scope/src/cli.ts npm run check:slow --workspaces --if-present",
```

Each block below builds a throwaway git repo from scratch, so the behaviour is reproducible anywhere. `echo` stands in for the package fan-out the wrapper guards. First: a branch whose only commit is a spec.

```bash
cli="$PWD/tools/check-scope/src/cli.ts"
repo=$(mktemp -d); cd "$repo"
git init -q -b main; git config user.email demo@alfred.test; git config user.name demo
mkdir -p docs/specs frontend; printf 'code\n' > frontend/app.ts
git add -A; git commit -qm base
git checkout -qb spec-only
printf 'the spec\n' > docs/specs/ALF-176.md
git add -A; git commit -qm spec
node "$cli" echo "STORYBOOK + PLAYWRIGHT + DATABASE SUITES RAN"
echo "gate exit: $?"
```

```output
check-scope: every change on this branch is under docs/ (1 file(s)) — skipping.
check-scope: skipped "echo STORYBOOK + PLAYWRIGHT + DATABASE SUITES RAN" — set CHECK_SCOPE_ALL=1 to run it anyway.
gate exit: 0
```

One touched code file is enough to bring the whole tier back — and mixing docs in doesn't buy an exemption. The reason names an offending path, so it is obvious *why* the suites are running:

```bash
cli="$PWD/tools/check-scope/src/cli.ts"
repo=$(mktemp -d); cd "$repo"
git init -q -b main; git config user.email demo@alfred.test; git config user.name demo
mkdir -p docs/specs frontend; printf 'code\n' > frontend/app.ts
git add -A; git commit -qm base

git checkout -qb code-only
printf 'more\n' >> frontend/app.ts; git add -A; git commit -qm code
echo "== code-only branch =="
node "$cli" echo "SUITES RAN"

git checkout -q main; git checkout -qb docs-and-code
printf 'spec\n' > docs/specs/ALF-176.md
printf 'more\n' >> frontend/app.ts; git add -A; git commit -qm mixed
echo "== branch mixing docs with code =="
node "$cli" echo "SUITES RAN"
```

```output
== code-only branch ==
check-scope: 1 change(s) outside docs/ (e.g. frontend/app.ts) — running the full tier.
SUITES RAN
== branch mixing docs with code ==
check-scope: 1 change(s) outside docs/ (e.g. frontend/app.ts) — running the full tier.
SUITES RAN
```

The gate keeps its teeth. A wrapped command that fails still fails the push, and every *uncertain* case runs the full tier rather than guessing — an unknown diff (no trunk ref to compare against), an empty one (trunk itself), and the `CHECK_SCOPE_ALL=1` escape hatch that forces the suites even on a docs-only branch:

```bash
cli="$PWD/tools/check-scope/src/cli.ts"
repo=$(mktemp -d); cd "$repo"
git init -q -b main; git config user.email demo@alfred.test; git config user.name demo
mkdir -p docs/specs frontend; printf 'code\n' > frontend/app.ts
git add -A; git commit -qm base

echo "== a wrapped command that fails still fails the push =="
git checkout -qb code-only
printf 'more\n' >> frontend/app.ts; git add -A; git commit -qm code
node "$cli" sh -c "exit 7"; echo "gate exit: $?"

echo "== escape hatch on a docs-only branch =="
git checkout -q main; git checkout -qb spec-only
printf 'spec\n' > docs/specs/ALF-176.md; git add -A; git commit -qm spec
CHECK_SCOPE_ALL=1 node "$cli" echo "SUITES RAN"

echo "== nothing changed vs trunk =="
git checkout -q main; node "$cli" echo "SUITES RAN"

echo "== no trunk ref to diff against =="
cd "$(mktemp -d)"; git init -q -b feature; git config user.email demo@alfred.test
git config user.name demo; printf 'spec\n' > spec.md; git add -A; git commit -qm spec
node "$cli" echo "SUITES RAN"
```

```output
== a wrapped command that fails still fails the push ==
check-scope: 1 change(s) outside docs/ (e.g. frontend/app.ts) — running the full tier.
gate exit: 7
== escape hatch on a docs-only branch ==
check-scope: CHECK_SCOPE_ALL is set — running the full tier.
SUITES RAN
== nothing changed vs trunk ==
check-scope: nothing changed vs trunk — running the full tier.
SUITES RAN
== no trunk ref to diff against ==
check-scope: the diff vs trunk is unknown — running the full tier.
SUITES RAN
```

The wrapper's own interface, for anyone wiring another command behind it:

```bash
node tools/check-scope/src/cli.ts --help
```

```output
check-scope — run a command only when the branch changes code.

Usage:
  check-scope <command> [args...]   Run <command> unless every change on this branch
                                    (vs the trunk merge-base) lives under docs/.

Only the FIRST argument is read as the command; everything after it is forwarded
verbatim, so the wrapped command keeps its own flags.

Environment:
  CHECK_SCOPE_ALL=1   Run the command unconditionally (the escape hatch — use it to
                      get the full tier on a docs-only branch).

Uncertainty always runs the command: an unknown diff (no git, no trunk ref, a shallow
checkout) or an empty one never counts as docs-only.

In this repo it wraps the check:slow fan-out from the root package.json, so a spec- or
demo-only push skips the Storybook, Playwright, and database suites it cannot break.
```

Net effect: a refinement or demo-only push now clears `check:slow` in about a second — `demo-lint` still runs, since that is the one gate a docs change *can* trip — instead of waiting on the Storybook, Playwright, and Postgres suites it cannot affect. The same wiring serves the pre-push hook and CI's `check-slow` job.

Two wrong-skip vectors the gate has to resist, since both *look* docs-only at a glance. First, a **rename out of a code directory into `docs/`**: git's default rename detection prints only the destination, so `git mv frontend/e2e/tasks.spec.ts docs/archive/` — a deleted E2E spec — would read as a pure docs change. `--no-renames` makes the move what it physically is, a delete plus an add. Second, an **unpushed commit on a local trunk**: if `origin/main` has not been fetched, a local `main` carrying code the remote has never seen would push the merge-base forward and hide that code, while the push still carries it out. The gate refuses a local trunk whenever an origin remote exists, and unknown trunk means run:

```bash
cli="$PWD/tools/check-scope/src/cli.ts"

echo "== a Playwright spec moved into docs/ =="
( cd "$(mktemp -d)"
  git init -q -b main; git config user.email demo@alfred.test; git config user.name demo
  mkdir -p frontend/e2e docs/archive; printf 'test\n' > frontend/e2e/tasks.spec.ts
  git add -A; git commit -qm base
  git checkout -qb move-spec
  git mv frontend/e2e/tasks.spec.ts docs/archive/tasks.spec.ts; git commit -qm move
  node "$cli" echo "SUITES RAN" )

echo "== docs-only branch stacked on an unpushed code commit =="
( d=$(mktemp -d); cd "$d"; git init -q --bare remote.git; git init -q -b main work; cd work
  git config user.email demo@alfred.test; git config user.name demo
  mkdir -p frontend docs/specs; printf 'v1\n' > frontend/app.ts; git add -A; git commit -qm base
  git remote add origin ../remote.git
  printf 'v2\n' >> frontend/app.ts; git add -A; git commit -qm "unpushed code"
  git checkout -qb spec-branch; printf 'spec\n' > docs/specs/x.md; git add -A; git commit -qm spec
  node "$cli" echo "SUITES RAN" )
```

```output
== a Playwright spec moved into docs/ ==
check-scope: 1 change(s) outside docs/ (e.g. frontend/e2e/tasks.spec.ts) — running the full tier.
SUITES RAN
== docs-only branch stacked on an unpushed code commit ==
check-scope: the diff vs trunk is unknown — running the full tier.
SUITES RAN
```
