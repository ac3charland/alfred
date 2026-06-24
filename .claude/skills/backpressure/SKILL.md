---
name: backpressure
description: >
  Documents how the deterministic checks (the back-pressure gates) are wired — where a new
  check belongs and which tier runs it. Use when adding or moving a check, linter, or gate, or
  wiring check:fast/check:slow — "add a check", "new linter", "monorepo-wide check", "run
  before storybook/e2e", "check:fast vs check:slow". Pairs with the npm-workspaces skill (the
  --workspaces fan-out) and commitlint (the husky hooks that invoke these).
---

# backpressure — wiring deterministic checks

The deterministic suites — type-check, lint/format, unit, snapshot, E2E, and the repo-wide
linters — are the **back-pressure** that steers generation toward correct, idiomatic code.
This skill covers the *constructive* side: when you add or move a check, **where it belongs**
and **which tier it runs in**. The *integrity* side — never weaken a gate to make it pass (no
config-loosening, ignore directives, or `--no-verify`) — lives in
[`CLAUDE.md`](../../../CLAUDE.md) under "Back-pressure: hard rules" and isn't repeated here.

## Where a check belongs: scope decides

A check's **scope** — the files it's responsible for — decides where it's wired.

- **Workspace-scoped** (the common case): a check over *one package's own code* — its
  `typecheck`, `lint`, `format`, `test`. It goes in **that workspace's** `check:fast` /
  `check:slow`; the root fan-out (`npm run <tier> --workspaces --if-present`) runs it there.
  A workspace `check:slow` may stand up an external service — the `database` package's
  `check:slow` runs the real-Postgres integration suite (it spins a throwaway cluster); no root
  edit was needed because the fan-out already runs every workspace's `check:slow`.

- **Monorepo-wide:** a check whose scope is the *whole repo* — `skill-lint` over all of
  `.claude/skills/`, `demo-lint` over all of `docs/demos/`. It goes **explicitly in the root**
  `check:fast` / `check:slow`, composed around the fan-out with `&&`:

  ```jsonc
  // root package.json
  "check:fast": "npm run lint:skills -w tools/skill-lint && npm run lint:migrations -w tools/migration-lint && npm run check:fast --workspaces --if-present",
  "check:slow": "npm run lint:demos  -w tools/demo-lint  && npm run check:slow --workspaces --if-present",
  ```

  `migration-lint` (over all of `database/migrations/`) is the third repo-wide linter, wired the
  same way and in `check:fast` because it's cheap and static.

The tool that *implements* a repo-wide check is usually itself a workspace (e.g.
`tools/skill-lint`), and it keeps its own `check:fast` for **its own** source. The distinction
is the *target*: linting the linter's `src/` is workspace-scoped; running the linter **against
the whole repo** is monorepo-wide, invoked from the root.

## Hoist a repo-wide check; never hide it in a workspace

Parking a repo-wide check inside the `check:*` of whatever workspace hosts the tool *works* —
the fan-out reaches it — but it **hides a global gate inside a package**: it looks
package-local, runs only as a side effect of the fan-out reaching that workspace (reorder the
workspaces or move the tool and it silently changes), and the root `check` — the canonical
"done for the repo" — never names it. Hoisting the call into the root makes the dependency
**explicit and greppable**: the root script *is* the list of what gates the repo.

## Order around the fan-out for the feedback you want

`&&` lets a root-level check run **ahead of** or **behind** the fan-out — a deliberate choice
about how fast to fail:

- **Ahead** (`my-check && npm run <tier> --workspaces …`) — fails fast. Use for a cheap
  repo-wide check you don't want to wait for the slow suites to reach. `demo-lint` runs ahead
  of `check:slow`, so a missing demo doc fails the push in ~1s instead of after the frontend's
  Storybook + Playwright suites (minutes).
- **Behind** (`npm run <tier> --workspaces … && my-check`) — runs after the packages are
  green. Use when the check is only meaningful once they pass, or is the expensive last step.

Default cheap repo-wide checks to **ahead** so the cheapest signal arrives first.

## Pick the tier for when the check is needed

The hooks (see the `commitlint` skill) map tiers to git events:

- **`check:fast` → pre-commit** — cheap, and relevant on *every* commit. Type-check,
  lint/format, unit tests, and fast repo-wide linters like `skill-lint` (it just reads
  markdown).
- **`check:slow` → pre-push** — expensive, **or not needed until you push / open the PR**.
  Storybook snapshots + Playwright E2E. `demo-lint` is here for the second reason: a demo isn't
  needed until right before the PR, so gating it per-push instead of per-commit keeps it from
  **harassing an agent committing as it goes**. (It also can't run earlier than it does: it
  reads the git branch to check the branch owns a demo doc.)

Put a check in the **earliest tier where it's actually relevant** — fast feedback is the point,
but a check that's only needed at push/PR time, or that costs seconds, belongs in slow so it
doesn't tax every commit.

## Hoisting to root means deleting from the workspace

A check must run **exactly once** per `check`. The fan-out runs *every* workspace's `check:*`,
so a check named in the root **and** still in a workspace's `check:*` runs **twice**. After
hoisting, remove the repo-wide call from the workspace — and if it *was* that workspace's whole
tier (e.g. `tools/demo-lint`'s `check:slow` was only `lint:demos`), drop the script so
`--if-present` skips it. Keep the underlying script (`lint:demos`, `lint:skills`) so the root
can call it with `-w`. Confirm the count:

```bash
npm run check:fast 2>&1 | grep -c "skill-lint:"   # expect 1
```

## Confirm the gate has teeth

A gate that never fails isn't a gate. After wiring one, Red/Green it like a feature: the real
root tier passes on a clean tree, then a deliberate violation makes it **exit non-zero at your
check** — and, if wired *ahead*, proves the slow suites never ran. A throwaway bad fixture (an
over-long skill description, a stray file in `docs/demos/`) trips a repo-wide linter
deterministically; revert it after.

## Related skills

- **`npm-workspaces`** — the `--workspaces --if-present` fan-out and `-w` targeting these compose with.
- **`commitlint`** — the husky `pre-commit` / `pre-push` hooks that invoke the root tiers.
- **`demo-lint`** / **`skill-lint`** / **`migration-lint`** — the repo-wide linters used as the examples here.
- **`supabase`** — the `database` integration suite (a workspace `check:slow`) that exercises real-Postgres semantics.
- **`showboat`** — produces the demo docs `demo-lint` gates on.
