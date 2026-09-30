---
branch: claude/ci-check-main-after-merge
---

# CI re-checks main after every merge

*2026-09-30T16:27:53.088Z*

A PR's CI tests its merge with the `main` it saw when it ran, and nothing re-checks `main` once PRs land. On 2026-09-30 that let two PRs, each green alone, break `main` together. #421 captured the `Wiki/WikiView › LandingPhone` baseline on a branch without #420's test-runner change (the viewport is now set before a story mounts), and its CI ran before #420 merged. The git history shows it:

```bash
git merge-base --is-ancestor 1309768e 74cbfde4 && echo 'the baseline had the viewport change' || echo "#421's baseline (74cbfde4) was captured without #420's viewport change (1309768e)"; git log -1 --format='#420 merged %cd' --date=format:%H:%M b05fdd5a; git log -1 --format='#421 merged %cd' --date=format:%H:%M f061eef3
```

```output
#421's baseline (74cbfde4) was captured without #420's viewport change (1309768e)
#420 merged 07:21
#421 merged 07:32
```

The fix: `ci.yml` also runs on every push to `main`, so a combination like that goes red on the merge that causes it, and GitHub emails whoever merged.

```bash
sed -n '/^on:/,/^jobs:/p' .github/workflows/ci.yml
```

```output
on:
  pull_request:
  # A PR's run tests its merge with the main it saw, so two PRs green alone can still break main
  # together. Re-checking main after every merge flags that when it lands.
  push:
    branches: [main]

jobs:
```

On `main` the diff against trunk is empty, so the trunk-scoped gates must still run the full tier rather than skip or fail. `check-scope` (which wraps `check:slow`'s package suites) runs everything on an empty diff, and `demo-lint` exempts `main` from owing a demo:

```bash
node --input-type=module -e "const { decideScope } = await import('./tools/check-scope/src/scope.ts'); console.log(decideScope([], false).reason)"; npm run lint:demos -w tools/demo-lint -- --branch main 2>&1 | tail -1
```

```output
nothing changed vs trunk — running the full tier.
demo-lint: 0 error(s), 0 warning(s).
```

On a real `main` checkout (at #416's merge), `check:fast` passed (6,428 frontend tests), and the secret, demo and skill linters all passed in trunk mode, so the new run won't go red on a clean merge.
