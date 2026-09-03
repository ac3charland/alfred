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
- [ ] `docs/demos/alf-151-habit-edit-spec/` — same shape, same cause (a `commitlint` SKILL.md note
      on a spec-only branch). Delete the folder; the spec is linked from the PR via htmlpreview.

---

## Second instance — a root config file does it too (2026-08-09 · `claude/llm-classifier-cron-spec-3h5g0l`)

Same rule, same mechanism, one class wider than `.claude/skills/**`.

A refinement branch carrying only `docs/specs/ALF-171.html` needed a four-line `.gitignore`
addition — the harness had created `.claude/worktrees/<id>/` for an isolated subagent, which is a
transient *nested checkout* that must never be committed. Adding the ignore entry flipped the
branch to "touches code" and `branch-folder` demanded a demo doc for an ignore rule, which has no
behavior to demonstrate. The showboat skill names this case explicitly — "Trivial, non-behavioral
changes (pure refactors, docs, **config**) don't need a demo doc" — so the gate and the skill
disagree.

**Why it widens the proposal above:** a `PROSE_PREFIXES` list covering `docs/` and
`.claude/skills/` still wouldn't cover `.gitignore`, because the problem isn't only "prose lives
outside `docs/`" — it's that the predicate asks *where a file lives* when the thing it cares about
is *whether the change has observable behavior*. Repo-root hygiene files (`.gitignore`,
`.gitattributes`, `.nvmrc`, editor config) are the other population with no demo to owe. Suggest
extending the skip to an explicit allow-list of such files alongside the prefixes, kept narrow and
enumerated rather than pattern-matched, so `package.json` and `wrangler.toml` — config that
genuinely changes behavior — keep owing a demo.

**Workaround used meanwhile:** dropped the `.gitignore` commit from the refinement branch entirely
and left `.claude/worktrees/` untracked, cleaning the directory up by hand once the subagent
finished. So the ignore entry this repo actually wants still isn't committed, and the next agent to
use worktree isolation will rediscover the same untracked path.

- [ ] Land the `.claude/worktrees/` ignore entry once a branch can carry it without owing a demo.

---

## Third instance — a *stale trunk ref* makes a docs-only branch look like a code branch (2026-09-02 · `claude/task-project-endpoints-spec-bgphpl`)

Same rule, same refinement shape, but a different cause: the branch really was docs-only, and
`branch-folder` still fired.

A remote (Claude Code for web) session starts from a fresh clone whose `origin/main` can be
several merges behind the commit the working branch was cut from. Here `origin/main` pointed at
`9489a0f` while the branch's own base was `4e86e28`, so `git diff origin/main...HEAD` reported
every file merged in between — `CLAUDE.md`, seven `SKILL.md`s, `docs/code-module/**` — as this
branch's changes. Not docs-only by that reading, so the push failed demanding a demo for a
single committed `.html` spec. `git fetch origin main` and an identical re-push went green.

**Why this is worth a rule change and not just "remember to fetch":** the tool already reasons
about a mismatched trunk in the *other* direction — `trunkRefIfBehind()` detects a branch behind
trunk and says so, precisely because "a stale base can mask a docs-only branch". The mirror case
(the local remote-tracking ref itself is stale, so the diff is taken against an old commit) is
invisible to it, and the error it produces names the wrong problem entirely: it tells you to write
a demo when what you needed was a fetch.

**Suggested change:** detect the stale ref instead of misreporting it. `git ls-remote --heads
origin main` is one cheap round trip with no side effects: if the sha it prints isn't the local
`origin/main`, the diff is being taken against an old commit, so emit *that* — `your origin/main
ref is stale (run git fetch origin main); trunk comparison skipped` — rather than the demo error.
`trunkRefIfBehind()` is the natural home; it already owns "the trunk ref and HEAD disagree", and
this is its mirror case. A plain `git fetch --quiet origin <trunk>` before computing
`changedPathsSinceTrunk` would also work and needs no new message, at the cost of a lint rule
mutating refs — probably the wrong trade for a linter, but worth weighing.

Either way the failure should be **loud about the ref, not about the demo**: today a fresh
session is told to produce evidence for a spec, which is both impossible and the wrong lesson.

**Workaround used meanwhile:** `git fetch origin main` before pushing. Cheap once you know; the
cost is entirely in the misdirected error message, which points a fresh session at writing demo
evidence for a spec.
