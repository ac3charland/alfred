# batch-commits: many commits, one gate run

*2026-06-11T18:47:28.925Z*

From one input file describing three commits, the batch-commits tool runs the `check:fast` gate exactly once (not three times), validates every message with commitlint, then creates all three commits. This demo drives a throwaway git repo whose `check:fast` is a stub that records each run, plus a `pre-commit` hook that records each time it fires, so we can count both.

Set-up: a sandbox repo with the stub gate and pre-commit hook, then three pending changes (two new files plus a README edit) ready to be split into three commits.

```bash
set -e
D="$PWD/.batch-commits-demo"
rm -rf "$D"
mkdir -p "$D"
cd "$D"
git init -q
git config user.email demo@example.com
git config user.name "batch demo"
git config commit.gpgsign false
# stub gate: records each run so we can prove it runs exactly once
printf '%s\n' '{ "name": "batch-commits-demo", "version": "1.0.0", "private": true, "scripts": { "check:fast": "echo ran >> gate-runs.log" } }' > package.json
# keep the run-tracking logs out of git
printf '%s\n' 'gate-runs.log' 'hook-runs.log' 'run.log' > .gitignore
# the batch input: three commits, each with its file(s)
printf '%s\n' \
  'message: feat(core): add alpha module' \
  '  alpha.ts' \
  '' \
  'message: feat(core): add beta module' \
  '  beta.ts' \
  '' \
  'message: docs(readme): mention the modules' \
  '  README.md' > batch.txt
printf '%s\n' '# demo' > README.md
git add package.json .gitignore batch.txt README.md
git commit -q -m "chore(seed): scaffold demo repo"
# install a pre-commit hook AFTER seeding; the batch must skip it via --no-verify
mkdir -p .git/hooks
printf '%s\n' '#!/bin/sh' 'echo ran >> hook-runs.log' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
# the finished, green changes to split into three commits
printf '%s\n' 'export const alpha = 1;' > alpha.ts
printf '%s\n' 'export const beta = 2;' > beta.ts
printf '%s\n' '' 'Uses the alpha and beta modules.' >> README.md
echo "pending changes before batching:"
git status --porcelain
```

```output
pending changes before batching:
 M README.md
?? alpha.ts
?? beta.ts
```

The batch input: a `message:` line per commit, each followed by its file paths.

```bash
cat "$PWD/.batch-commits-demo/batch.txt"
```

```output
message: feat(core): add alpha module
  alpha.ts

message: feat(core): add beta module
  beta.ts

message: docs(readme): mention the modules
  README.md
```

Run the tool. It validates every message, runs the gate once, then creates all three commits with --no-verify.

```bash
D="$PWD/.batch-commits-demo"
S="$PWD/.claude/skills/batch-commits/scripts/batch-commit.mjs"
cd "$D" || { echo "sandbox missing"; exit 1; }
node "$S" batch.txt > /dev/null 2>&1
echo "tool exit code: $?"
echo "--- git history (newest first) ---"
git log --format='%s'
```

```output
tool exit code: 0
--- git history (newest first) ---
docs(readme): mention the modules
feat(core): add beta module
feat(core): add alpha module
chore(seed): scaffold demo repo
```

The gate ran exactly once for the whole batch:

```bash
echo "check:fast (gate) runs during the batch: $(wc -l < "$PWD/.batch-commits-demo/gate-runs.log" | tr -d ' ')"
```

```output
check:fast (gate) runs during the batch: 1
```

And the per-commit hook was skipped for every commit, so the redundant re-checks never happened:

```bash
f="$PWD/.batch-commits-demo/hook-runs.log"
if [ -f "$f" ]; then n=$(wc -l < "$f" | tr -d ' '); else n=0; fi
echo "per-commit hook fired during the batch: $n times"
```

```output
per-commit hook fired during the batch: 0 times
```

Three commits, one gate run, zero per-commit hook fires: the redundant per-commit re-checks are eliminated while the single run still validates the whole tree. In the real repo that one run is the actual `check:fast`, and `pre-push` / `check:slow` is untouched.

```bash
rm -rf "$PWD/.batch-commits-demo"
echo "sandbox removed"
```

```output
sandbox removed
```
