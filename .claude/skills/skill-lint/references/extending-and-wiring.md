# skill-lint — extending and wiring

One-time / occasional tasks: understand the architecture, add a rule, change a threshold,
re-confirm how the tool hangs off `check:fast`, and maintain its TypeScript source. For
day-to-day use (running it, the rules, fixing findings), stay in the SKILL.md body.

## Contents

- [Architecture: a rule registry over parsed skills](#architecture-a-rule-registry-over-parsed-skills)
- [Adding a rule](#adding-a-rule)
- [Where the thresholds come from](#where-the-thresholds-come-from)
- [How it's wired into check:fast](#how-its-wired-into-checkfast)
- [Maintaining the TypeScript source](#maintaining-the-typescript-source)

## Architecture: a rule registry over parsed skills

The tool consists of small modules under `tools/skill-lint/src/`, deliberately split so the
extension point (rules) is isolated from parsing and I/O:

- **`skill.ts`** — turns a `SKILL.md` path into a `SkillContext`: frontmatter `name` /
  `description` (a YAML block scalar is folded to one string), the body, its line count,
  the parsed headings (code fences excluded), and the bundled resource directories
  (`isCompound` is just "has at least one subdirectory"). It also resolves CLI
  path/glob/dir arguments into the list of `SKILL.md` files to lint.
- **`rules.ts`** — the registry. Each rule is a `Rule` (`{ name, description, check }`)
  where `check(skill: SkillContext): Finding[]` is a **pure function** of the context.
  The exported `rules` array is applied to every skill in order. Thresholds live here as
  named constants.
- **`lint.ts`** — orchestration: run every rule over every skill, collect `SkillReport`s,
  tally severities.
- **`git.ts`** — the changed-skill detection for the gate: `changedPathsSinceTrunk()` (the
  one impure spot — it shells out to git) feeds the pure `changedSkillNames()` and
  `selectChangedSkills()`. The git call is isolated so the mapping/filter logic stays
  unit-testable with literal paths (mirroring how `demo-lint` keeps its raw git calls out of
  the tested core).
- **`cli.ts`** — argument parsing (`--all`), the default-skills-dir resolution, the
  check-mode changed-set filter, human-readable output, and the exit code (1 if any error,
  else 0; usage errors exit 2).

The data flow is one direction: `cli → resolve paths → (check mode: filter to changed) →
parseSkill → lintSkills(rules) → report`. A rule never touches the filesystem or argv;
everything it needs is on `SkillContext`. That's what keeps rules trivial to unit-test
(construct a context literal, call the rule) and the set easy to grow.

## Adding a rule

1. Decide what the rule reads. If it needs something not yet on `SkillContext` (say, the
   raw frontmatter, or the list of links in the body), add that field to the interface in
   `skill.ts` and populate it in `parseSkill` — once, for every rule to share.
2. Write the rule in `rules.ts` as a `Rule` constant. Return one `Finding` per problem (or
   `[]` to pass). Pick the severity deliberately: **error** for something that breaks the
   guidance and must be fixed before commit; **warn** for advice that shouldn't block the
   gate. Write the `message` as "what's wrong + how to fix it" — it's the whole UX.
3. Append it to the exported `rules` array. Nothing else changes — `lint.ts` and `cli.ts`
   are rule-agnostic.
4. Add a test in `rules.test.ts`: build a `SkillContext` with the `makeSkill` helper and
   assert the finding (or its absence). Every behavior change must move a test (the repo's
   TDD rule), and a pure rule is cheap to cover.
5. Document it: add a row to the rules table in the SKILL.md body.

A rule that needs a new threshold should export it as a named constant next to
`DESCRIPTION_MAX_CHARS` / `BODY_MAX_LINES`, with a comment tracing it to its source, so
the value has one home the docs can point at.

## Where the thresholds come from

The numbers are not arbitrary — each traces to the `skill-creator` skill
(`.claude/skills/skill-creator/SKILL.md`), which is the source of truth for skill
authoring:

- **`DESCRIPTION_MAX_CHARS = 1024`** — skill-creator: descriptions stay "under the
  ~1024-char cap." That cap is the per-skill slice of the `available_skills` listing
  budget Claude sees; past it the description is silently truncated and triggering
  degrades. Hence an **error**.
- **`DESCRIPTION_SOFT_MAX_CHARS = 700`** — a tightness target well under the hard cap. A
  description past it is usually smuggling in body content (rule details, implied context,
  extra scope) instead of stating the subject + triggers, so it's a **warning** that nudges a
  re-check, never a failure. It only surfaces on skills you actually changed (the gate is
  changed-only), so the nudge lands on the description you're editing, not the whole library.
- **repo name ⇒ no-repo-name** — skill-creator: the agent already knows which repo it's in
  (CLAUDE.md), so naming it ("…in alfred") is redundant scope that wastes the front-loaded,
  length-capped triggering budget. Mechanically checkable, so it's an **error** rather than
  prose nobody enforces.
- **`BODY_MAX_LINES = 500`** — skill-creator: keep SKILL.md "under 500 lines" ideal, and
  past that add hierarchy / push detail into `references/`. The guidance explicitly says
  you may go longer when warranted, so this is a **warning**, not an error.
- **compound ⇒ TOC** — skill-creator's progressive-disclosure model: SKILL.md is the
  always-loaded index, bundled resources load on demand, and they only get loaded if the
  index points at them. A compound skill without a TOC near the top hides its own
  resources, so this is an **error**. The "first or second top-level section" placement
  matches the existing `batch-commits` and `playwright` TOCs.

If the guidance changes, change the constant (and the comment) here — don't scatter the
number across rules.

## How it's wired into check:fast

`lint:skills` is **monorepo-wide** — its scope is the whole `.claude/skills/` tree, not the
`tools/skill-lint` package — so it's hoisted into the **root** `check:fast`, ahead of the
workspace fan-out, not buried in the package's own `check:fast` (see the `backpressure` skill
for the where-a-check-lives rule):

```jsonc
// root package.json
"check:fast": "npm run lint:skills -w tools/skill-lint && npm run check:fast --workspaces --if-present",
// tools/skill-lint/package.json
"lint:skills":       "node src/cli.ts",          // the gate: changed skills only
"lint:skills:audit": "node src/cli.ts --all"      // the full sweep
```

`tools/skill-lint`'s own `check:fast` is just the standard package gate (typecheck → lint →
format → test) over its **own** source — it does **not** call `lint:skills`, or the root call
plus the fan-out would run it twice.

Because `lint:skills` passes no path, `cli.ts` resolves its default library — the repo's
`.claude/skills`, located relative to the CLI file (`fileURLToPath(import.meta.url)`, three
levels up) rather than the cwd, so it works whether invoked from the package dir or the repo
root — and then **filters to the skills changed vs trunk**. The root `audit:skills` script
(`--all`) skips that filter to sweep everything.

Only **errors** fail the gate; warnings (`body-length`, `description-tightness`) are printed
but exit 0.

## Maintaining the TypeScript source

It's run straight from source via Node's native type-stripping (`node src/cli.ts`) — no
build step — which imposes the same constraints as `tools/showboat`:

- **Import local modules with the explicit `.ts` extension** (`./skill.ts`). Node's loader
  throws `ERR_MODULE_NOT_FOUND` on extensionless relative imports; `tsconfig` sets
  `allowImportingTsExtensions`, ESLint requires `ts: 'always'`, and Jest strips it via
  `moduleNameMapper`.
- **Erasable syntax only** (`erasableSyntaxOnly: true`) — no `enum`, `namespace`, parameter
  properties, or `import =`.
- **No `process.exit()`** (`unicorn/no-process-exit`) — return a code from `main` and set
  `process.exitCode`.
- **No mutating `.sort()`** (`unicorn/no-array-sort`). `toSorted()` would need ES2023 but
  the package targets ES2022, so `skill.ts` uses a small non-mutating insertion-sort
  helper, mirroring `frontend/lib/tree.ts`. Reach for that helper rather than re-deriving
  the workaround.
- Tests run under ts-jest ESM (`NODE_OPTIONS=--experimental-vm-modules`).
