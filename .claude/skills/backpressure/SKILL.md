---
name: backpressure
description: >
  Documents alfred's house style for wiring deterministic checks (the back-pressure gates) —
  specifically WHERE a check belongs. A workspace-scoped check (a package's own
  typecheck/lint/format/test) lives in that workspace's check:fast/check:slow; a
  MONOREPO-WIDE check (linting the whole .claude/skills/ or docs/demos/ tree) belongs
  explicitly in the ROOT check:fast/check:slow, ahead of or behind the --workspaces fan-out —
  never hidden inside one workspace's script. Also covers the fast-vs-slow tier choice
  (pre-commit vs pre-push), removing a hoisted check from the workspace so the fan-out doesn't
  double-run it, and ordering a cheap repo-wide check before the slow suites so it fails fast.
  Use when adding or moving a check / linter / gate, wiring check:fast or check:slow, or asking
  "why is this lint in the root vs a package" — "add a check", "new linter", "monorepo-wide
  check", "gate the whole repo", "run before storybook/e2e".
---

# backpressure — wiring deterministic checks in alfred

The deterministic suites (type-check, lint/format, unit, snapshot, E2E, plus the repo-wide
linters) are the **back-pressure** that steers generation toward correct, idiomatic code.
This skill is about the **constructive** side: when you add or move a check, *where does it
belong* and *which tier does it run in*. The **integrity** side — never weaken a gate to make
it pass (no config-loosening, no ignore directives, no `--no-verify`) — lives in
[`CLAUDE.md`](../../../CLAUDE.md) under "Back-pressure: hard rules"; read that too, it's
non-negotiable and this skill doesn't repeat it.

## The two kinds of check, and where each lives

Every check has a **scope** — the set of files it's responsible for — and that scope decides
where it's wired:

- **Workspace-scoped** — a check over *one package's own code* (its `typecheck`, `lint`,
  `format`, `test`). It belongs in **that workspace's** `check:fast` / `check:slow`, because
  the package owns it and the root fan-out (`npm run <tier> --workspaces --if-present`) runs
  it there. This is the default and the common case.

- **Monorepo-wide** — a check whose scope is the *whole repo*, not any one package: linting
  the entire `.claude/skills/` tree (`skill-lint`), the entire `docs/demos/` tree
  (`demo-lint`), or anything else that reasons about the repo as a whole. It belongs
  **explicitly in the root** `check:fast` / `check:slow`, composed alongside the fan-out:

  ```jsonc
  // root package.json
  "check:fast": "npm run lint:skills -w tools/skill-lint && npm run check:fast --workspaces --if-present",
  "check:slow": "npm run lint:demos  -w tools/demo-lint  && npm run check:slow --workspaces --if-present",
  ```

The tool that *implements* a monorepo-wide check is usually itself a workspace (e.g.
`tools/skill-lint`), and that workspace still has its own `check:fast` for **its own** source
(typecheck/lint/test of the linter's code). The distinction is the *target*: linting the
linter's own `src/` is workspace-scoped; running the linter **against the whole repo** is
monorepo-wide and is invoked from the root.

## Why a monorepo-wide check must be hoisted, not hidden

It is tempting to park a repo-wide check inside the `check:*` of whatever workspace happens
to host the tool — `tools/demo-lint`'s `check:slow` just calls `lint:demos`, and the root
fan-out reaches it, so it *runs*. **Don't.** That hides a repo-wide dependency inside a
package script where nothing signals its true scope:

- It **looks package-local** but actually gates the entire repo — a surprise to the next
  reader, who has no reason to open a tool's `package.json` to discover a global gate.
- It runs **only as a side effect** of the fan-out happening to reach that workspace. Change
  the workspace order, the `--if-present` semantics, or move the tool, and a global gate
  silently changes or disappears — with no edit to the root that's supposed to own "what
  gates this repo".
- The root `check` command — the canonical, top-level definition of "done for the whole
  repo" — **doesn't mention it**, so reading the root tells you less than the truth.

Hoisting the call into the root makes the dependency between the tool and the whole repo
**explicit and greppable**: the root script *is* the list of what gates the repo.

## Ahead or behind the fan-out — order for the feedback you want

A root-level check can run **before** or **after** the `--workspaces` fan-out; `&&` makes the
order a deliberate choice about *what to gate on and how fast to fail*:

- **Ahead** (`my-check && npm run <tier> --workspaces …`) — the repo-wide check runs first, so
  it **fails fast**. Use this when the check is cheap and you don't want to pay for the slow
  workspace suites before learning a repo-wide rule is broken. `demo-lint` runs ahead of
  `check:slow`: a missing/misplaced demo doc fails the push in ~1s instead of after the
  frontend's Storybook snapshots + Playwright E2E (several minutes).
- **Behind** (`npm run <tier> --workspaces … && my-check`) — the fan-out runs first. Use this
  when the repo-wide check is only meaningful *after* the packages are green, or is the
  expensive step you want to reach last.

When in doubt, put cheap repo-wide checks **ahead** so the cheapest signal arrives first.

## Which tier: fast (pre-commit) vs slow (pre-push)

The tier is the other half of the wiring decision. The hooks (see the `commitlint` skill) map
tiers to git events:

- **`check:fast` → pre-commit.** Cheap, runs on *every commit*. Type-check, lint/format, unit
  tests, and cheap repo-wide linters like `skill-lint` (it just reads markdown — fast, and
  worth catching before the commit lands).
- **`check:slow` → pre-push.** Expensive, or needs state a single commit doesn't have. The
  frontend's Storybook snapshots + Playwright E2E live here. So does `demo-lint`: it needs the
  **git branch** (it checks the branch owns a demo doc) and a demo is the last thing you
  produce before pushing, so push-time is the right moment.

Rule of thumb: put a check in the **fastest tier consistent with what it needs** — fast
feedback is the whole point, but a check that needs the branch (or costs seconds) belongs in
slow so it doesn't tax every commit.

## When you hoist a check to root, delete it from the workspace

A check should run **exactly once** per `check` invocation. The root fan-out
(`--workspaces --if-present`) runs *every* workspace's `check:*`, so if a check is **both**
named in the root script **and** still present in a workspace's `check:*`, it runs **twice** —
wasted time and confusing output. After hoisting:

- Remove the repo-wide call from the workspace's `check:*`. When that call *was* the
  workspace's whole tier (e.g. `tools/demo-lint`'s `check:slow` was only `lint:demos`), drop
  the script entirely — `--if-present` then cleanly skips that workspace for that tier.
- Keep the underlying script that *does* the work (`lint:demos`, `lint:skills`) so the root can
  call it with `-w`.

Verify the count after wiring: run the root tier and confirm the check appears once.

```bash
npm run check:fast 2>&1 | grep -c "skill-lint:"   # expect 1
```

## Verifying a gate actually has teeth

A gate that never fails isn't a gate. After wiring (or changing) a check, confirm **both**
directions, the same way you'd Red/Green a feature:

- **Green:** the real root tier passes on a clean tree (`npm run check:fast` / `check:slow`).
- **Red:** introduce a deliberate violation, run the root tier, and confirm it **exits
  non-zero at your check** — and, if you wired it *ahead*, that the slow suites never ran
  (proving the fail-fast ordering). Then revert the violation. For a repo-wide linter, a
  throwaway bad fixture (an over-long skill description, a stray file directly in
  `docs/demos/`) trips it deterministically.

This mirrors the repo's TDD stance: a check you haven't watched fail is a check you don't know
works.

## Related skills

- **`npm-workspaces`** — the `--workspaces --if-present` fan-out mechanics, `-w` targeting,
  and the root-orchestrator model these checks compose with.
- **`commitlint`** — the husky `pre-commit` / `pre-push` / `commit-msg` hooks that *invoke*
  the root `check:fast` / `check:slow`.
- **`demo-lint`** / **`skill-lint`** — the two monorepo-wide linters used as the running
  examples here; read them for each tool's own rules.
- **`showboat`** — produces the demo docs that `demo-lint` gates on.
