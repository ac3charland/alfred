---
name: git
description: >
  Covers git CLI workflows in the monorepo: author/committer identity for verified commits,
  rewriting commit metadata, safe rebase patterns, resolving a conflicting pull so the branch
  stays rebase-mergeable, and the "stale local main" trap. Use when running git rebase,
  git merge, git filter-branch, git push --force, amending commits, resolving conflicts with
  main, or fixing unverified commit warnings from the stop hook.
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

## First rule out the false alarm: an unpushed tip mid-`check:slow`

The stop hook flags commits not yet on `origin`. A `git push` runs the **pre-push gate
(`check:slow`)** — Storybook snapshots + Playwright E2E, minutes long — so while that push is
in flight the tip commit isn't on the remote yet and the hook fires on it, even though it is
**correctly signed**. Don't reach for the rewrite recipes below on reflex: they'd force a
needless force-push of an already-good commit.

Confirm it's the race, not a real problem, before rewriting:

```bash
git cat-file commit HEAD | grep -E '^(committer|gpgsig)'   # committer noreply@anthropic.com + an SSH gpgsig? → signed fine
git rev-parse HEAD; git rev-parse origin/<branch>          # equal once the push lands → hook clears itself
```

Local `git log --format=%G?` shows **`N` for every commit** (verified or not) because
`gpg.ssh.allowedSignersFile` isn't configured in the worktree — so `%G?` is **not** a signal
here. Trust the `gpgsig` header + committer email instead. Only rewrite (below) when the commit
genuinely lacks a `gpgsig` line or shows the wrong committer email.

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
Before pushing a change that narrows a widely-used type, **`git fetch origin main && git rebase
origin/main`** and re-run `check:fast` so the fallout surfaces locally instead of in CI. Rebase
rather than merge — see below.

## Listing what a branch changed vs trunk (for a scoped gate)

A gate that only fires for branches touching some path — `migrationsChangedSinceTrunk` in
`database/src/gen-types.ts`, `changedPathsSinceTrunk` in `tools/skill-lint/src/git.ts` — has to
assemble that file list itself, and two defaults quietly break it:

- **`git diff --name-only <merge-base>` lists only tracked files.** A brand-new file is untracked
  until it's added, so a gate keyed on "did this branch add one?" skips exactly the case it exists
  for — and skips it *silently*, reading as a pass. Union the diff with
  `git ls-files --others --exclude-standard`.
- **The two commands disagree on path roots.** `git diff --name-only` prints repo-root-relative
  paths; **`git ls-files` prints cwd-relative** ones, so from inside a package the same file arrives
  as `migrations/0028.sql` from one and `database/migrations/0028.sql` from the other, and a prefix
  match against the combined list fails. Pass **`--full-name`** to `ls-files`. (`:/path` pathspecs
  are cwd-independent in both, so anchor pathspecs that way.)

Both failures are silent passes, so prove a scoped gate with a **red run**: create the triggering
file, confirm the gate fails, then satisfy it and confirm it passes. A gate only ever observed green
hasn't been tested.

## Resolve a conflicting pull by rebasing, never merging

PRs land via GitHub's **rebase** merge, which replays only **non-merge** commits. Resolve a
conflict with `git merge origin/main` and the branch becomes un-mergeable: GitHub replays each
commit's *pre-merge* version into the changed base, hits the very conflict you fixed, and
auto-merge stalls — your resolution lives only in the merge commit's tree, which is never
replayed. `git rebase origin/main` puts it in ordinary commits, where it survives.

Check a branch before relying on auto-merge: `git log --merges origin/main..HEAD` must be empty.

To linearize a branch whose resolution is already trapped in a merge commit, don't re-resolve it
commit by commit — lift the tree you already validated:

```bash
git checkout -B linearize origin/main
git checkout <merge-sha> -- .              # the exact validated tree, nothing re-derived
git rm <path>                              # only for a file the merge tree DELETED — see below
git diff <merge-sha> --exit-code           # prove it — no output means identical
# re-commit by concern, then move the branch and:
git push --force-with-lease -u origin <branch>
```

`git checkout <sha> -- .` only writes files; it never removes one the merge tree dropped, so a
`git mv` lands as a copy with the original still sitting at its old path. The `git diff
--exit-code` is what catches it — `git rm` the leftover and re-check until the diff is silent.

**A force-push turns auto-merge off.** GitHub disables it whenever the head branch is
force-pushed, so the branch you just made mergeable will sit there forever unless you re-enable
it — `gh pr merge --auto --rebase`, or the `enable_pr_auto_merge` MCP tool in the web sandbox.
Re-enabling is part of the linearize, not a follow-up.
