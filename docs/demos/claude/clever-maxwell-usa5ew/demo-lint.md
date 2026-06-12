# demo-lint: enforce the docs/demos folder-per-demo structure

*2026-06-12T19:30:19.652Z*

All demo docs now live in their own folder under docs/demos/ — never as loose files. `tools/demo-lint` enforces two rules and runs in the global `check:slow` (pre-push). This doc exercises both rules, the showboat folder-creation that satisfies them, and the build wiring. (The `--branch` flag overrides the git branch so the output is deterministic.)

Rule **no-root-files** — only README.md may sit directly in docs/demos/. A loose demo file at the root is an error (here against a throwaway fixture; `--branch main` so rule 2 stays out of the way):

```bash
mkdir -p tools/demo-lint/tmp-demo
touch tools/demo-lint/tmp-demo/README.md tools/demo-lint/tmp-demo/stray-demo.md
node tools/demo-lint/src/cli.ts --branch main tools/demo-lint/tmp-demo; echo "exit=$?"
rm -rf tools/demo-lint/tmp-demo
```

```output

tools/demo-lint/tmp-demo
  ✗ error [no-root-files] tools/demo-lint/tmp-demo/stray-demo.md is a file directly in tools/demo-lint/tmp-demo/. Every demo lives in its own folder — move it into tools/demo-lint/tmp-demo/<branch-or-feature>/.

demo-lint: 1 error(s), 0 warning(s).
exit=1
```

Rule **branch-folder** — while on a feature branch, the branch owes a folder named after it. Missing (or empty) → error; once the folder holds the branch's demo doc → clean. A slash in the branch name nests:

```bash
mkdir -p tools/demo-lint/tmp-demo
echo "# feature branch, no demo folder yet:"
node tools/demo-lint/src/cli.ts --branch claude/cool-feature tools/demo-lint/tmp-demo; echo "exit=$?"
echo "# after creating docs/demos/<branch>/ with a doc:"
mkdir -p tools/demo-lint/tmp-demo/claude/cool-feature
touch tools/demo-lint/tmp-demo/claude/cool-feature/demo.md
node tools/demo-lint/src/cli.ts --branch claude/cool-feature tools/demo-lint/tmp-demo; echo "exit=$?"
rm -rf tools/demo-lint/tmp-demo
```

```output
# feature branch, no demo folder yet:

tools/demo-lint/tmp-demo
  ✗ error [branch-folder] branch "claude/cool-feature" has no demo folder. Create tools/demo-lint/tmp-demo/claude/cool-feature/ and capture this branch's demo there (e.g. npm run demo -- init tools/demo-lint/tmp-demo/claude/cool-feature/<name>.md "<title>").

demo-lint: 1 error(s), 0 warning(s).
exit=1
# after creating docs/demos/<branch>/ with a doc:

demo-lint: 0 error(s), 0 warning(s).
exit=0
```

`showboat init` creates that branch folder for you (it `mkdir -p`s the parent), so you can init a doc straight into a folder that doesn't exist yet:

```bash
work=tools/showboat/tmp-demo
rm -rf "$work"
node tools/showboat/src/cli.ts init "$work/claude/auto-made/demo.md" "Auto folder" 2>/dev/null
test -f "$work/claude/auto-made/demo.md" && echo "init created $work/claude/auto-made/demo.md (the folder did not exist before)"
rm -rf "$work"
```

```output
init created tools/showboat/tmp-demo/claude/auto-made/demo.md (the folder did not exist before)
```

Wiring: demo-lint runs in the package's `check:slow`, which the root `check:slow` fan-out (the pre-push gate) picks up:

```bash
node -p "require('./tools/demo-lint/package.json').scripts['check:slow']"
```

```output
npm run lint:demos
```

And the real docs/demos passes on this branch — no loose root files after the reorg, and this very doc gives the branch its folder:

```bash
node tools/demo-lint/src/cli.ts; echo "exit=$?"
```

```output

demo-lint: 0 error(s), 0 warning(s).
exit=0
```
