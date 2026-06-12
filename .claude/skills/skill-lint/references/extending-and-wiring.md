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

The tool is four small modules under `tools/skill-lint/src/`, deliberately split so the
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
- **`cli.ts`** — argument parsing, the default-skills-dir resolution, human-readable
  output, and the exit code (1 if any error, else 0; usage errors exit 2).

The data flow is one direction: `cli → resolve paths → parseSkill → lintSkills(rules) →
report`. A rule never touches the filesystem or argv; everything it needs is on
`SkillContext`. That's what keeps rules trivial to unit-test (construct a context literal,
call the rule) and the set easy to grow.

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

`tools/skill-lint` is an npm workspace (under the root `package.json` `workspaces:
["tools/*"]`). Its own `check:fast` runs the standard package gate **and then** the
linter over the whole library:

```jsonc
// tools/skill-lint/package.json
"lint:skills": "node src/cli.ts",
"check:fast": "npm run typecheck && npm run lint && npm run format && npm run test && npm run lint:skills"
```

The root `check:fast` fans out to every workspace (`npm run check:fast --workspaces
--if-present`), so the skill lint runs on every commit with no root-level wiring. Because
`lint:skills` passes no path, `cli.ts` falls back to its default: the repo's
`.claude/skills`, located relative to the CLI file (via `fileURLToPath(import.meta.url)`,
three levels up) rather than the cwd — so it lints the real library whether it's invoked
from the package dir during the fan-out or from the repo root by hand.

Only **errors** fail the gate; the `body-length` warning is printed but exits 0.

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
