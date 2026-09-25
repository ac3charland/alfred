---
branch: claude/fix-rename-tests-hook-git-env
---

# Rename tests stay out of the repository a git hook pins

*2026-09-25T02:28:11.619Z*

Git exports `GIT_DIR` and `GIT_INDEX_FILE` into its hooks, and the pre-commit hook runs the skill-lint and demo-lint rename tests. Those tests build a throwaway repo and commit in it, but they inherited the hook's pin. Every git command they ran, including the ones inside the function under test, hit the repository being committed to. From a linked worktree that meant fixture commits on the branch, junk branches (`archive-the-spec`, `move-a-resource`), and `user.name=test`, `user.email=test@example.com` and `core.bare=true` in the shared config.

The fix: both tests hand every git command an explicit environment with git's own list of repo-pinning variables (`rev-parse --local-env-vars`) removed. It has to be explicit, because Jest's `process.env` is a per-file copy that never reaches child processes. Each tool's `changedPathsSinceTrunk` takes that environment as a parameter, defaulting to the caller's own, so the CLIs behave exactly as before.

Below, both suites run the way a hook runs them, pinned at a throwaway repository ([`pinned-run.sh`](./pinned-run.sh)). The script then reports what they left there: nothing.

```bash
sh docs/demos/hook-safe-rename-tests/pinned-run.sh
```

```output
skill-lint rename suite ran under the pin: exit 0
demo-lint rename suite ran under the pin: exit 0
branches in the pinned repo:  0
commits in the pinned repo:   0
test identity in its config:  0
core.bare before -> after:    false -> false
```
