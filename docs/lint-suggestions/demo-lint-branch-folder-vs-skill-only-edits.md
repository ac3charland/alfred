# demo-lint `branch-folder` — a `.claude/skills/**` edit makes a docs-only branch demand a demo

**Rule(s):** `demo-lint/branch-folder` (`tools/demo-lint`)
**Package / scope:** repo-wide — the `check:slow` / pre-push gate
**Date / branch:** 2026-07-25 · `claude/pr-ratio-spec-7ayhnw`

## What happened

A **refinement** branch whose only deliverable was `docs/specs/ALF-131.html` pushed cleanly.
Then the CLAUDE.md compounding-learning rule fired (a stale `containerd.pid` had blocked the
Storybook snapshot gate), so the insight was recorded in `.claude/skills/storybook/SKILL.md` —
a documentation edit with no behavior. The next push failed:

```
../../docs/demos
  ✗ error [branch-folder] branch "claude/pr-ratio-spec-7ayhnw" has no demo. Capture it in its
    own folder under ../../docs/demos/ — npm run demo -- init ../../docs/demos/<feature-name>/<name>.md
    "<title>" records this branch in the doc's front matter automatically.

demo-lint: 1 error(s), 0 warning(s).
```

## Why the rule doesn't fit here

`branch-folder` skips a **docs-only** branch — one whose every change vs trunk lives under
`docs/`. That skip encodes the right idea ("prose changes have no behavior to demo"), but it
tests the idea by **path prefix**, and the skill library lives at `.claude/skills/`, outside
`docs/`. So a SKILL.md edit — pure prose, zero runtime surface — flips the branch to "touches
code" and demands demo evidence that cannot exist.

Two repo rules collide as a result. CLAUDE.md requires recording a compounding-learning
insight **the same turn** you resolve it, and the `refinement` skill requires a refinement PR to
carry **only the spec**. Obeying both puts a SKILL.md edit on a docs-only branch — which is
exactly the shape `branch-folder` now rejects. The showboat skill agrees the demo isn't owed
here: "Trivial, non-behavioral changes (pure refactors, docs, config) don't need a demo doc."

## Suggested change

Treat the skill library as prose for the docs-only skip: widen the predicate from "every change
is under `docs/`" to "every change is under `docs/` **or** `.claude/skills/`". In
`tools/demo-lint`, wherever the docs-only check is computed:

```ts
const PROSE_PREFIXES = ['docs/', '.claude/skills/'];
const isProseOnly = (changed: string[]): boolean =>
  changed.every((file) => PROSE_PREFIXES.some((prefix) => file.startsWith(prefix)));
```

Deliberately narrow: `.claude/skills/**` is prose, but `tools/**` (including `tools/demo-lint`
itself) stays code and keeps owing a demo. A skill that ships an executable script under
`.claude/skills/*/scripts/**` — e.g. `batch-commits` — is the one grey area; if that matters,
exclude `scripts/` from the prefix rather than dropping the skip.

## Workaround used meanwhile

Wrote `docs/demos/alf-131-pr-ratio-spec/spec.md`, whose evidence is a screenshot of the rendered
spec HTML. It's honest — that page *is* the branch's deliverable, and seeing it render is mildly
useful — but the gate is what created it, and the full-page PNG is ~1.9 MB of git for a
refinement PR. Neither of the two prior refinement PRs (ALF-123, ALF-130) carries a demo doc.

## Workarounds to rip out if the rule changes

- [ ] `docs/demos/alf-131-pr-ratio-spec/` — delete the folder (doc + PNG); a spec-only refinement
      branch owes no demo, and the spec is already linked from the PR via htmlpreview.
