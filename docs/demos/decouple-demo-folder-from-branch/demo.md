---
branch: claude/great-hypatia-63t38q
---

# Decouple demo folder name from branch via front matter

*2026-06-12T23:56:36.848Z*

Showboat can now give demo folders semantic, feature-related names while still satisfying demo-lint's branch-folder rule. The branch is recorded in the doc's YAML front matter, and demo-lint reads it from there instead of requiring the folder to be named after the branch.

1) `npm run demo -- init` stamps the current branch into the doc's front matter (override with `--branch`). Here we init a doc inside a semantically-named folder (`cool-feature/`) and show the front matter it wrote:

```bash
tmp=$(mktemp -d)
npm run --silent demo -- init "$tmp/cool-feature/demo.md" "Cool feature" --branch feat/cool 2>/dev/null
head -3 "$tmp/cool-feature/demo.md"
```

```output
---
branch: feat/cool
---
```

2) demo-lint is satisfied by the front matter, no matter what the folder is called. Below, the demo lives in a `cool-feature/` folder but its front matter claims branch `feat/cool` — demo-lint reads that and reports zero errors:

```bash
d=$(mktemp -d)
mkdir -p "$d/cool-feature"
printf -- '---\nbranch: feat/cool\n---\n\n# Cool feature\n\n*ts*\n' > "$d/cool-feature/demo.md"
npm run --silent lint:demos -w tools/demo-lint -- --branch feat/cool "$d" 2>/dev/null | grep "error("
```

```output
demo-lint: 0 error(s), 0 warning(s).
```

3) The rule keeps its teeth: a feature branch that owns no demo at all — neither a front-matter claim nor a legacy branch-named folder — still fails. Pointing demo-lint at the same fixture as branch `feat/orphan` fires branch-folder:

```bash
d=$(mktemp -d)
mkdir -p "$d/cool-feature"
printf -- '---\nbranch: feat/cool\n---\n\n# Cool feature\n\n*ts*\n' > "$d/cool-feature/demo.md"
npm run --silent lint:demos -w tools/demo-lint -- --branch feat/orphan "$d" 2>/dev/null | grep -oE "\[branch-folder\]|[0-9]+ error\(s\)"
```

```output
[branch-folder]
1 error(s)
```

This very demo doc dogfoods the change: it lives in the semantically-named folder `docs/demos/decouple-demo-folder-from-branch/`, yet its own front matter (top of this file) records `branch: claude/great-hypatia-63t38q` — which is how demo-lint accepts it on this branch.
