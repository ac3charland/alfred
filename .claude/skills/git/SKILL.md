---
name: git
description: >
  Covers git CLI workflows in the monorepo: author/committer identity for verified commits,
  rewriting commit metadata, safe rebase patterns, and the "stale local main" trap.
  Use when running git rebase, git filter-branch, git push --force, amending commits,
  or fixing unverified commit warnings from the stop hook.
---

# git skill (alfred)

## Commit author identity

The stop hook enforces that commits on feature branches use:

```
user.email = noreply@anthropic.com
user.name  = Claude
```

Set these before any commit session:

```bash
git config user.email noreply@anthropic.com && git config user.name Claude
```

## Rewriting author metadata on existing commits

### The safe way: `rebase --onto` + `filter-branch` on the right base

Always scope rewrites to commits **above `origin/main`**, never above the local `main`
ref — local `main` is never kept in sync with the remote (the worktree never runs
`git pull main`) and can be dozens or hundreds of commits behind, causing rewrites to
touch shared history.

**To fix author on commits already pushed (or not yet pushed):**

```bash
# 1. Rewrite metadata only — no hooks, no code changes
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --env-filter '
GIT_COMMITTER_EMAIL="noreply@anthropic.com"
GIT_COMMITTER_NAME="Claude"
GIT_AUTHOR_EMAIL="noreply@anthropic.com"
GIT_AUTHOR_NAME="Claude"
' origin/main..HEAD

# 2. If the rewritten commits are now on a wrong base (stale-main trap — see below),
#    rebase them onto the correct parent before force-pushing:
#    git rebase --onto origin/main <SHA of commit just before your feature commits>

# 3. Force push
git push --force-with-lease -u origin <branch>
```

### Do NOT use `git rebase --exec "git commit --amend --reset-author"`

This approach runs `git commit --amend` after each replayed commit. That triggers the
pre-commit hook (`check:fast` → `eslint --fix` → `prettier --write`), which modifies
files in-place, leaving unstaged changes and causing the amend to fail with husky
exit code 2. The `filter-branch --env-filter` approach rewrites metadata directly
without touching the working tree or running any hooks.

## The stale-local-main trap

**Problem:** `git filter-branch main..HEAD` (or `git rebase main`) uses the *local*
`main` ref, which is never updated in this worktree. If local `main` is 50 commits
behind `origin/main`, the range `main..HEAD` includes all those shared commits and
filter-branch rewrites them all — producing a branch with hundreds of rewritten
commits that diverge from `origin/main`.

**Recovery:** After a stale-main filter-branch accident, the feature commits are
correct but stranded on top of the rewritten shared history. Rebase them off:

```bash
# <parent-sha> = the rewritten version of what should be origin/main's tip
git rebase --onto origin/main <parent-sha>
# Then sync local main so it doesn't happen again:
git branch -f main origin/main
```

**Prevention:** Always use `origin/main` (not `main`) as the base in rebase and
filter-branch commands:

```bash
git filter-branch -f --env-filter '...' origin/main..HEAD  # ✓
git rebase --onto origin/main ...                           # ✓
git rebase main ...                                         # ✗ stale-main trap
```

## CI tests the merge with main, not your branch tip

The `check-fast` CI job checks out `refs/pull/<n>/merge` — your branch **merged into
the current `origin/main`** — so it sees files that exist on `main` but never on your
branch. A green local `check:fast` can therefore still fail CI: tighten a shared type
(e.g. make an `items` column **required** on `Item`) and a fixture added to `main` by a
PR that merged after you branched fails `tsc` on the merge, in a file you never touched.
Before pushing a change that narrows a widely-used type, **`git fetch origin main && git
merge origin/main`** (or rebase onto it) and re-run `check:fast` so the merge's fallout
surfaces locally instead of in CI.
