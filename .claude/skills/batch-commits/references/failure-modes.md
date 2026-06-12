# Edge cases & failure modes

- **Fixers mutate files** (`eslint --fix` / `prettier --write`) → handled by
  running the gate in step 3 *before* staging; the fixers are idempotent
  afterward, so staging captures the final content.
- **A bad commit message** → caught in step 2, before any commit.
- **Same file in two commits** → caught in step 1 (hunk-splitting is out of scope).
- **An empty group / a path with no pending changes** → caught in step 4.
- **A pathspec typo** → caught in step 4.
- **Untracked, deleted, or renamed files** → `git add` handles adds and deletions;
  for a rename, list both the old and new path.
- **Leftover changes** (a formatter touched a file you didn't list) → reported in
  step 6, not an error; commit or discard them yourself.
- **Mid-batch failure** (rare, after validation passes) → the tool stops, prints
  which commits landed, and leaves the rest in the working tree. It never
  auto-rolls-back; inspect with `git status` and continue manually.
- **A single commit** → the tool still works (one gate run, one `--no-verify`
  commit), but a plain `git commit` is fine too.