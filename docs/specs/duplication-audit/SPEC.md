# Monorepo duplication audit — a copy-paste detector (`audit:dupes`)

> **Status:** Refinement spec. Hand to an implementation session. Small, self-contained tooling change.
> **Companion to** [`docs/specs/frontend-dry-refactor/SPEC.md`](../frontend-dry-refactor/SPEC.md) (the
> refactor) and the `frontend-architecture` skill (the standing guidance). **Skills to read first:**
> `backpressure` (where checks live and which tier), `npm-workspaces` (the fan-out), `eslint`.

## Context / problem

The DRY audit surfaced two kinds of duplication. The **structural reuse** anti-patterns (hand-rolled
`<button>`, raw Radix dialogs, inline `supabase.from`) are catchable by deterministic ESLint rules —
those are speced as the "Regression ratchet" section of
[`docs/specs/frontend-dry-refactor/SPEC.md`](../frontend-dry-refactor/SPEC.md), each rule shipped and
enforced by the phase that fixes its anti-pattern. But a second class can't be matched by any single
AST rule:

- **Literal copy-paste** spread across files — the `grid-rows-[0fr↔1fr]` height-transition block (4×),
  the Radix `Dialog.Root → Portal → Overlay → Content` scaffold (3×), the duplicated `navLinkClass` /
  `launchPhaseFor` bodies, the per-store `assertNever`. A by-name rule catches the known few; it can't
  catch the *next* unknown copy.
- **Near-duplicate logic** — the optimistic capture→reconcile/rollback dance re-pasted per store
  action, the inline-edit state machine per field. (A token detector catches these only where the text
  is genuinely similar; the behavioral-but-textually-different cases stay the province of review + the
  skill.)

A **token-level copy-paste detector** is pattern-agnostic: it reports any run of duplicated tokens
above a threshold, so it catches today's copies *and* tomorrow's without anyone enumerating them.

## Scope: the whole monorepo, one central run

The audit that motivated this looked only at `frontend/`, but that's where we *looked* — not a reason
to limit the *tool*. Duplication is just as worth catching inside `workers/` or the `tools/*` packages,
the marginal cost of scanning them is ~nil, and a **single repo-wide run can detect clones that span
packages** (e.g. a helper copied from `frontend` into a worker) that a per-package run would miss by
construction. So this is a **monorepo-wide** audit.

It's wired as **one central root script**, not a `--workspaces` fan-out, for two reasons: a single pass
sees cross-package clones, and there's **one `minTokens` threshold to tune** instead of one per package.
That mirrors `audit:skills`, which sweeps the whole skill library from the root rather than per-package.
(Tiered `check:*` scripts fan out via `--workspaces --if-present` because each package's gate is
independent; a duplication audit is the opposite — it wants the global view. See the `backpressure` and
`npm-workspaces` skills.)

The scanned packages are the TS/JS source: `frontend`, `workers`, and `tools` (the `tools/*` packages).
`database/` is excluded — it's SQL migrations, which are append-only and where repetition is expected,
not a refactor target.

## Key decision: a non-blocking audit, not a gate

Copy-paste detection is **heuristic and threshold-sensitive** — some flagged clones are intentional
(parallel test fixtures, similar-by-coincidence JSX) and the "right" min-token threshold is a judgement
call. Wiring it as a hard `check:fast` / `check:slow` gate would either block on false positives or get
tuned so loose it's meaningless — and a noisy gate erodes the back-pressure rules' integrity (a gate
only works if a red result always means "fix the code"). So it ships as a **standalone audit script you
run on demand**, exactly like `audit:skills` (the full skill sweep) and Stryker mutation testing — a
periodic signal, not a commit gate. See the `backpressure` and `stryker` skills for the precedent.

## Proposed change

### 1. Add `jscpd` as a root devDependency

`jscpd` is the de-facto copy-paste detector for JS/TS — configurable thresholds, multiple reporters
(console + JSON), and a glob/ignore model. Add it to the **root** `package.json` `devDependencies`
(`npm i -D jscpd` at the repo root, since the audit spans every package). No custom tool package is
needed — unlike `skill-lint` / `demo-lint` (bespoke linters with no off-the-shelf equivalent), this is
a standard tool we only configure.

### 2. Config: root `.jscpd.json`

```json
{
  "gitignore": true,
  "reporters": ["console", "json"],
  "output": ".jscpd-report",
  "format": ["tsx", "ts", "javascript"],
  "minTokens": 50,
  "threshold": 100,
  "ignore": [
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/*.test.{ts,tsx}",
    "**/*.stories.tsx",
    "**/e2e/**",
    "**/*.gen.ts",
    "**/lib/database.types.ts",
    "**/next-env.d.ts",
    "**/worker-configuration.d.ts"
  ]
}
```

- **`minTokens: 50`** is a starting point — tune so the report surfaces the audit's known clones (the
  `grid-rows` block, the dialog scaffold) without drowning in trivial 3-line matches. Record the tuned
  value in the skill once calibrated.
- **`threshold: 100`** = report only, never exit non-zero. The audit *informs*; it doesn't fail. (A
  future, separately-decided "gate mode" could lower this — out of scope here.)
- Tests, stories, e2e, build output, and generated files are excluded — duplicated fixtures and
  generator output are not refactor targets (consistent with how ESLint/Prettier already ignore
  generated files).

### 3. The script

Add a single **root** `package.json` script that scans every TS/JS package (mirroring `audit:skills`,
which is also root-only):

```json
"audit:dupes": "jscpd --config .jscpd.json frontend workers tools"
```

Run **only** through the npm script — never the `jscpd` binary directly (the CLAUDE.md rule: the
`npm run` indirection is the source of truth for scope + ignores). The `.jscpd-report/` output dir is
git-ignored. No per-package script and no `--workspaces` fan-out (see "Scope" — the audit is
deliberately one global pass).

### 4. Interpreting the output

The console reporter prints each clone pair (files + line ranges + token count); the JSON reporter
writes the full set to `.jscpd-report/jscpd-report.json`. Each clone is a **candidate** for extraction —
cross-reference the `frontend-architecture` skill's "where it goes" guidance (a shared
`components/atoms` piece, a `lib/hooks` hook, a `lib/**` helper; for a worker, a shared module under its
own `src/`). A cross-package clone is a flag to hoist the shared code to a spot both can import. Not
every clone must be removed (judgement applies — that's why it's an audit, not a gate), but a *growing*
count between runs is the signal that DRY discipline is slipping.

### 5. Record it in the skill library

Per the compounding-learning rule, add a one-line pointer in the `frontend-architecture` skill's
"Pointers" section — "run `npm run audit:dupes` to find literal copy-paste the named lint rules don't
catch (monorepo-wide)" — and note the tuned `minTokens` value once calibrated, so the audit is
discoverable from the skill an agent already reads before frontend work.

## Acceptance criteria

- [ ] `jscpd` is a **root** devDependency; root `.jscpd.json` configures format/ignore/threshold;
      `.jscpd-report/` is git-ignored.
- [ ] `npm run audit:dupes` (from the repo root) runs the detector over `frontend`, `workers`, and
      `tools`, prints the console report, writes the JSON report, and **exits 0 regardless of findings**
      (audit, not gate).
- [ ] `minTokens` is tuned so the run surfaces at least the audit's known clones (the `grid-rows`
      height-transition block and the duplicated Radix dialog scaffold) without flooding on trivial
      matches; the chosen value is recorded.
- [ ] The `frontend-architecture` skill points to the audit. `check` stays green (the audit is **not**
      wired into `check:fast`/`check:slow`).
- [ ] A demo doc captures a sample run (`npm run demo -- exec` of `audit:dupes`) so a reviewer sees the
      report shape.

## Out of scope / open questions

- **Not a commit/push gate.** Deliberately advisory (see "Key decision"). Promoting it to a gate — with
  a tuned threshold and an allowlist for sanctioned clones — is a separate, later decision.
- **No auto-fix.** The detector finds clones; extraction is a human/agent judgement following the
  `frontend-architecture` skill, not a mechanical rewrite.
- **`database/` (SQL migrations).** Excluded — append-only migrations repeat by nature and aren't a
  refactor target. Revisit only if meaningful SQL duplication appears.
- **Behavioral duplication that isn't textually similar** (the same *pattern* spelled differently) won't
  be caught by a token detector — that remains the province of the `frontend-architecture` skill and
  code review, as noted in the refactor spec's ratchet section.
