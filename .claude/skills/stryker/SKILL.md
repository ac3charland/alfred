---
name: stryker
description: >
  Covers Stryker mutation testing (StrykerJS): what mutation
  testing measures (test-assertion quality, not line coverage), the per-package
  stryker.config.json setup wired to Jest + ts-jest, the `npm run mutation` script,
  coverageAnalysis choices, mutant states + the mutation-score formula, interpreting
  survived mutants, the npm-workspaces sandbox/node_modules gotcha, the ts-jest
  disableTypeChecks interaction, and why mutation testing is a standalone audit (NOT
  wired into check:fast / check:slow). Use when running, configuring, or reasoning about
  mutation testing — "stryker", "stryker run", "npm run mutation", "mutation score",
  "survived mutant", "killed mutant", "@stryker-mutator", "stryker.config.json", or
  "why did this mutant survive".
---

# StrykerJS mutation testing (alfred monorepo)

Sources used:
- StrykerJS official docs — stryker-mutator.io / `stryker-mutator/stryker-js` repo `docs/` (introduction, configuration, jest-runner, getting-started, troubleshooting) — maintainer org
- `@stryker-mutator/core` + `@stryker-mutator/jest-runner` package.json (v9.6.1, Node ≥22) — maintainer org
- "Supported mutators" — stryker-mutator.io/docs/mutation-testing-elements/supported-mutators — maintainer org
- Verified live in this repo: `npm run mutation -w frontend -- --mutate lib/tree.ts` → 87.65% score (see `docs/demos/stryker-mutation-testing.md`)

---

## Mental Model: tests grading your tests

Line/branch coverage tells you a line **ran** during the test suite. It says
nothing about whether any assertion would **notice** if that line were wrong.
Mutation testing closes that gap. Stryker:

1. Parses your source and generates **mutants** — single, deliberate breakages
   (`a + b` → `a - b`, `>` → `>=`, `'x'` → `''`, `??` → `&&`, remove a `return`).
2. For each mutant, runs the tests that cover that line.
3. Records the outcome: if **a test fails, the mutant is _killed_** (good — your
   suite caught the bug). If **all tests still pass, the mutant _survived_**
   (bad — a real bug here would ship green).

The **mutation score** is the percentage of detectable mutants that were killed.
A survived mutant is a precise, reproducible pointer at a missing or weak
assertion — not a missing line of coverage. That's the whole value: it audits
the *quality* of assertions, the one thing coverage can't see.

**The non-obvious part:** mutation testing is **expensive** — it re-runs (a
subset of) the test suite once *per mutant*, so a single file can mean dozens of
test runs. Stryker makes this tractable with **coverage analysis** (only run the
tests that actually cover each mutant) and **concurrency** (worker processes).
This cost is why it is an *occasional audit*, never a per-commit gate.

### How a run executes (so you can debug it)

`source → instrument/mutate → copy package to a sandbox (.stryker-tmp) → run the
test runner per mutant → report`. Stryker copies the package into a sandbox
directory and runs Jest there, restoring nothing in your real tree. Most
"it doesn't work" problems are sandbox problems (module resolution, missing
files) — see Pitfalls.

---

## Decision Tree

**Which `coverageAnalysis`?** (set in `stryker.config.json`)
- `perTest` *(our default)* → Stryker maps which test covers which mutant and
  runs only those tests. Fastest. Requires a test runner that reports per-test
  coverage — the Jest runner does. **Use this** unless something forces otherwise.
- `all` → run the whole file's covering tests, no per-test mapping. Use only if
  `perTest` misbehaves (e.g. global state shared across tests).
- `off` → run the *entire* suite for every mutant. Slowest; last resort.

**What should `mutate` cover?**
- **Pure logic** (`lib/**` helpers, reducers, schema/validation, API route
  handlers) → **yes, prime targets.** High signal, fast, deterministic.
- **React components / Next pages** (`*.tsx`) → mutable, but slower and noisier;
  many "survived" mutants are cosmetic. Mutate deliberately, not by default.
- **Generated files** (`lib/database.types.ts`, `*.gen.ts`) → **never** — exclude
  with a `!` glob.
- **Side-effecting glue** (the Supabase client factories, middleware) → low value;
  little branching logic to mutate.

**Do you need the TypeScript checker plugin (`checkers: ["typescript"]`)?**
- Default: **no.** It compiles each mutant and discards type-uncompilable ones
  before running tests — more accurate, but much slower and needs a tsconfig that
  `include`s every mutated file. Skip it unless survived-but-uncompilable mutants
  are skewing your score. (Not installed in this repo.)

**Which package do I run in?** Stryker is configured **per workspace**
(`frontend/`, `workers/`, `tools/showboat/`), each with its own
`stryker.config.json` pointing at that package's `jest.config.ts`. Run it for one
package at a time: `npm run mutation -w <package>`.

---

## Plain-English → Pattern Table

| When you want to… | Do this | Key things to know |
| --- | --- | --- |
| Mutation-test one file (the fast feedback loop) | `npm run mutation -w frontend -- --mutate lib/tree.ts` | `--mutate <glob>` overrides the config's `mutate` array; cwd is the workspace, so the path is package-relative |
| Mutation-test a whole package | `npm run mutation -w frontend` | Uses the config's `mutate` globs; can be slow for `*.tsx` — scope it |
| Add Stryker to a new package | `npm i -D -w <pkg> @stryker-mutator/core @stryker-mutator/jest-runner`, add `stryker.config.json` + a `"mutation": "stryker run"` script | Mirror an existing package's config; point `jest.configFile` at that package's `jest.config.ts` |
| See *which* assertions are missing | Open the HTML report: `<pkg>/reports/mutation/mutation.html` | Lists every survived mutant with file:line and the exact mutation; gitignored |
| Speed up a slow run | Lower `concurrency`, narrow `mutate`, keep `coverageAnalysis: "perTest"` | `concurrency` defaults to CPU-cores−1; memory pressure → set it lower (e.g. 4) |
| Stop a known-pointless mutant from counting against the score | Add a `// Stryker disable next-line <mutator>: <reason>` comment **in the source** | This is the *one* sanctioned in-source directive for Stryker; it's not an ESLint/TS bypass. Use sparingly, always with a reason |
| Fail CI/locally below a score | Set `thresholds.break` in the config | `break: null` by default (never fails). Leave it null here — mutation is an audit, not a gate |
| Run an ESM/native-TS package (showboat) | Already wired: `testRunnerNodeArgs: ["--experimental-vm-modules"]` in its config | Mirrors that package's `NODE_OPTIONS=--experimental-vm-modules` test script |
| Re-run faster after small edits | `incremental: true` (opt-in) | Caches results in `reports/stryker-incremental.json`; re-tests only changed mutants |

---

## Mutant states & the score (read the report correctly)

Every mutant lands in exactly one state:

- **Killed** — a test failed. ✅ The suite caught it.
- **Survived** — all tests passed despite the mutation. ❌ Assertion gap. **This
  is the actionable output** — add/strengthen an assertion to kill it.
- **No coverage** — no test ran this code at all. A *coverage* gap (weaker signal
  than survived; fix with any test that exercises the line).
- **Timeout** — the mutant caused an infinite loop / hang; counted as killed
  (the suite "detected" it by diverging). Controlled by `timeoutMS` + `timeoutFactor`.
- **Runtime error / Compile error** — the mutant couldn't run; **excluded** from
  the score entirely (neither killed nor survived).
- **Ignored** — excluded by a `// Stryker disable` comment or `mutator` config.

**Score formula** (Stryker prints two columns):
```
mutation score          = (killed + timeout) / (killed + timeout + survived + no-coverage) × 100
mutation score covered  = (killed + timeout) / (killed + timeout + survived)               × 100
```
`covered` ignores no-coverage mutants — it answers "of the code my tests *touch*,
how well do they assert?" Default `thresholds`: `{ high: 80, low: 60, break: null }`
(colour-coding only; `break` is what would fail a run, and we keep it `null`).

**Supported mutators** (what gets broken): Arithmetic, Array Declaration,
Assignment, Block Statement, Boolean Literal, Conditional Expression, Equality
Operator, Logical Operator, Method Expression, Object Literal, Optional Chaining,
Regex, String Literal, Unary Operator, Update Operator. (Confirmed against the
maintainer "supported mutators" page.)

---

## Common Pitfalls (hard rules)

- **Never wire `mutation` into `check:fast` / `check:slow` or the husky hooks.**
  It re-runs the suite per mutant — minutes, not seconds. It is a standalone
  `npm run mutation` audit, by design. (The user confirmed this scoping.)
- **In this npm-workspaces monorepo, hoisted deps live at the repo-root
  `node_modules`.** Stryker's sandbox sits *inside* the package
  (`<pkg>/.stryker-tmp/sandbox-*`), so Node resolution walks up to the root
  `node_modules` and the default sandbox run works. **If you ever see "Cannot find
  module" inside the sandbox, switch that package's config to `"inPlace": true`**
  (mutates files in place, no sandbox copy, restored on completion) rather than
  fighting symlinks.
- **ts-jest type-checks by default; mutants routinely produce type errors.**
  Stryker's `disableTypeChecks` defaults to `true`, injecting `// @ts-nocheck`
  into each mutated file so ts-jest runs the mutant as plain JS instead of failing
  to compile it. Leave it on. If mutated files outside `src`/`lib`/`test` throw
  `"Cannot assign to 'stryNS_…'"`, widen it to a glob:
  `"disableTypeChecks": "{app,components,lib}/**/*.{ts,tsx}"`.
- **Keep `coverageAnalysis: "perTest"` with the Jest runner.** The runner also
  uses `--findRelatedTests`, so a single-file run only executes that file's tests.
- **Inline `/** @jest-environment node */` pragmas break the run — point them at
  the Stryker env instead.** For `perTest` coverage the runner swaps the
  *config-level* `testEnvironment` (in `jest.config.ts`) for a Stryker-wrapped one
  that reports per-test coverage (see `with-coverage-analysis.js`). It does **not**
  reach a per-file docblock pragma — jest applies that itself, loading the literal
  `jest-environment-node`, which reports no coverage. The whole run then aborts at
  the dry run: `ERROR DryRunExecutor One or more tests resulted in an error: Missing
  coverage results for: You probably configured a test environment in jest that is
  not reporting code coverage to Stryker`. Fix it exactly as Stryker's error says —
  change the node-context test files' first line to
  `/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */` (jsdom →
  `.../jest-env/jsdom`). That wrapper is **transparent** outside Stryker (the mixin
  only does anything when the `__stryker__` context is present), so `npm run test` /
  `check:fast` are unaffected. The config-level default (`jsdom` in frontend, `node`
  in workers) needs **no** change — Stryker auto-wraps it; only per-file overrides
  need the explicit Stryker env. You can't collapse the pragmas into one global
  `testEnvironment` because the suite genuinely uses both jsdom (React) and node
  (API routes / lib) and the runner doesn't support jest `projects`.
- **Each package's `.prettierignore` must list the Stryker artifacts itself.** A
  package's `format` script runs `prettier --write .` from the package dir, so the
  *closest* `.prettierignore` applies — the root one is **not** consulted. If a
  package gets Stryker but its own `.prettierignore` omits `.stryker-tmp/`,
  `stryker.log`, `reports/mutation.html`, and `reports/mutation/`, then `format`
  (and `check:fast`) will reformat the generated HTML report in place — editing a
  generated artifact, which CLAUDE.md forbids. Add those four entries to the
  package `.prettierignore` (ESLint already ignores `.stryker-tmp/**` per package).
- **Never run `check:fast` / `check:slow` / `npm run test` *while* a `mutation` pass is
  in flight, and you CANNOT fix that with jest config.** Jest's `testMatch` scans the
  whole tree (default ignore is only `node_modules`), so a check that runs concurrently
  with a mutation run discovers the `*.test.*` copies Stryker wrote under
  `.stryker-tmp/sandbox-*` and re-runs them — they fail (providers/testids resolve
  against the mutated sandbox, not your tree) and red the gate for a reason unrelated to
  your code. The tempting fix — `testPathIgnorePatterns: ['/.stryker-tmp/']` — **breaks
  Stryker outright**: Stryker runs jest *inside* `.stryker-tmp/sandbox-*` with rootDir set
  there, so the pattern matches the sandbox's own tests and the dry run aborts with "No
  tests were executed." The test file's absolute path is identical whether jest runs from
  your tree or from inside the sandbox, so no `testPathIgnorePatterns` entry can tell them
  apart. The only fix is operational: **sequence the steps** — let a mutation run finish
  (it removes `.stryker-tmp` on a clean exit; `rm -rf <pkg>/.stryker-tmp` if you killed
  it) before you commit/push or run any check.
- **Jest multi-`projects` config is unsupported by the runner.** Our packages use
  single-project Jest configs — keep it that way for any package you mutate.
- **A survived mutant is a finding, not a failure to silence.** Fix it by adding
  an assertion in the **test**, never by deleting the mutator or disabling it
  (unless the mutation is genuinely equivalent/meaningless — then a documented
  `// Stryker disable next-line` comment is acceptable).
- **Don't over-claim "equivalent" on a guard that a disabled button or shared
  flag seems to make unreachable — it's usually killable.** Two recurring traps in
  this repo's React components:
  • A handler guard that duplicates a submit button's `disabled` (e.g.
    `if (!name.trim() || isPending) return` inside `onSubmit`) is **still
    reachable** by submitting the form *directly* — `fireEvent.submit(form)` /
    `form.requestSubmit()` bypasses the disabled button. Submit with the empty/
    invalid value and assert the action mock was **not** called; that kills both
    the `if(false)` ConditionalExpression and the `||`→`&&` LogicalOperator mutant.
  • A re-entrancy guard on a **shared** `isPending` (one flag for create/rename/
    delete) is reachable **cross-operation**: hold one action pending (a deferred
    promise), then trigger another whose button has no `disabled` — the original
    guard blocks it, the mutant doesn't. Assert the second action's mock wasn't called.
  Genuinely-equivalent guards do exist (a TS null/optional-chain guard unreachable
  given the types; a `useState` initial always overwritten before first render; an
  empty-array `Promise.all`/dispatch that no-ops) — those get a documented
  `// Stryker disable next-line <Mutator>: AT_CEILING — <why>`. The test: *could any
  assertion on state, a mock call, or rendered output ever differ?* If yes, kill it.
- **A cosmetic `className` `StringLiteral` mutant is a coverage gap, not a ceiling — kill
  it, don't suppress it.** A Tailwind class string survives only because no test asserts it
  (the mutator just empties it → `''`). Extract the class cluster into a co-located
  `*.styles.ts` module (the `lib/ui/nav-link-class.ts` pattern) and lock it with a
  `toContain` test; for a primitive whose className is its identity, assert it on rendered
  output with `toHaveClass`. Prefer the style module when the class is **state-conditional**
  (drop-target, edit-mode, `isOver`): a `toContain` test kills the mutant without
  reproducing that state in jsdom. A bare module-level `const` string mutant IS killed this
  way — Stryker runs its load-time initializer (static coverage) against the module's test.
- **The generated report is a generated artifact.** `<pkg>/reports/mutation/` is
  gitignored *and* prettier-ignored, and `.stryker-tmp/` is eslint-ignored. Never
  hand-edit or format them. (Adding those ignores when a package first gets
  Stryker is the expected config change.)
- **`ignorePatterns` ≠ `.gitignore` semantics.** It is a list of globs of files
  *not to copy into the sandbox* (speed), not a mutate filter. We exclude `.next`,
  `storybook-static`, `coverage`, etc. To exclude files from *mutation*, use a
  `!` entry in `mutate`.

---

## Version Gotchas (StrykerJS v9.x)

- **Node ≥ 22 is required** (`@stryker-mutator/core@9` engines). This repo runs
  Node 22.x — fine. Agents trained on older Stryker may assume Node 16/18.
- **Scaffold with `npm init stryker@latest`**, not a long-dead global install. It
  emits a `stryker.config.mjs`; this repo standardised on `stryker.config.json`
  (no lint/format surface, valid for every package). Both are supported config
  forms (`.json` / `.mjs` / `.cjs` / `.js`).
- **`coverageAnalysis: "perTest"` is the modern default** and the Jest runner
  supports it natively — don't downgrade to `"off"` out of caution.
- **The default HTML report path is `reports/mutation/mutation.html`** in v9 (older
  content says `reports/mutation.html`); our ignore patterns cover both.
- **The package is `@stryker-mutator/*`** (the old `stryker` / `@stryker-mutator/
  javascript-mutator` packages are obsolete — don't install them).

---

## What Was Deliberately Left Out (and why)

- **`@stryker-mutator/typescript-checker`** — accurate but slow and needs tsconfig
  `include` to cover every mutated file. Not installed; revisit only if
  uncompilable mutants skew a score. (See the Decision Tree.)
- **The Stryker Dashboard reporter / mutation-testing.com upload** — that's a
  hosted-CI/badge workflow; this is a single-user, run-locally audit.
- **CI gating on mutation score (`thresholds.break`)** — explicitly out of scope:
  mutation testing here is a manual audit, not a pre-push gate. Left `null`.
- **`create-react-app` / Angular / Karma / Vitest / Mocha runner setups** — this
  monorepo is Jest-only; only the `jest-runner` is documented to avoid an agent
  reaching for the wrong runner.
- **Custom Babel `mutator.plugins` overrides** — only needed for exotic syntax
  (legacy decorators, Vue SFCs); our TS/TSX parses with Stryker's defaults.
