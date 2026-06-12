---
name: commitlint
description: >
  Covers commit-message validation in the alfred monorepo: commitlint rule tuples
  ([level, applicable, value]), the project's stricter-than-conventional rules (scope required,
  no body, no footer, lowercase subject), the commit-msg git hook wired via husky v9, and the
  pre-commit / pre-push hooks that fan out to npm workspace packages. Use when editing
  commitlint.config.* or .husky/ hook files, or enforcing conventional-commit format —
  "require scope", "forbid body", "lowercase only", git hook setup, or husky install.
---

# commitlint + husky skill (alfred monorepo)

**Sources:**
- commitlint rules reference: `conventional-changelog/commitlint` repo, `docs/reference/rules.md` (source-verified against `@commitlint/rules/src/*.ts`)
- commitlint config-conventional defaults: `@commitlint/config-conventional/src/index.ts` (source-verified)
- commitlint local-setup guide: `docs/guides/local-setup.md`
- husky v9 docs: `typicode/husky`, `docs/get-started.md` + `docs/how-to.md` + `docs/migrate-from-v4.md`
- Conventional Commits spec: conventionalcommits.org v1.0.0

---

## Mental Model

commitlint is a linter for git commit messages. It parses a raw message string into structured parts (type, scope, subject, body, footer) and runs each part through a set of named rules. Every rule uses a `[level, applicable, value]` tuple:

- **level** — `0` = off, `1` = warning, `2` = error
- **applicable** — `'always'` means "enforce the condition is true"; `'never'` means "enforce the condition is false"
- **value** — the constraint argument (a string, array, or number depending on the rule)

The **condition** embedded in the rule name is the thing being tested. For example:
- `body-empty` condition: "body is empty" — so `[2, 'always']` = error if body is NOT empty; `[2, 'never']` = error if body IS empty.
- `scope-empty` condition: "scope is empty" — so `[2, 'never']` = error if scope IS empty (scope required).

This always/never-against-the-condition pattern is the most common source of rule misconfiguration. Read the condition, then apply the applicable value.

**husky** manages git hooks as plain files in `.husky/`. In v9 each hook is a simple shell script — no shebang required (scripts are POSIX compliant), no `husky add` command, no `.huskyrc`. The `"prepare": "husky"` script in `package.json` registers the `.git/hooks` symlinks automatically on `npm install`.

**In alfred**, husky lives at the repo root. Hook files call root-level npm scripts that fan out to workspaces:
```
.husky/commit-msg  → npx --no -- commitlint --edit $1
.husky/pre-commit  → npm run check:fast   (fans out via workspace runner)
.husky/pre-push    → npm run check:slow   (fans out via workspace runner)
```
commitlint reads `commitlint.config.*` from the repo root and applies a single rule set to every commit regardless of which package changed.

---

## Plain-English → Pattern Table

| When the task says… | Rule / config to use | Key things to know |
|---|---|---|
| "scope is required" | `'scope-empty': [2, 'never']` | `'never'` negates the `scope-empty` condition → scope must NOT be empty. This is not in `config-conventional` defaults — add it explicitly in `rules`. |
| "forbid a commit body" / "body must be empty" | `'body-empty': [2, 'always']` | `'always'` enforces the `body-empty` condition → error if any body content is present. Default in `config-conventional` is `[2, 'never']` (body required) — you must override. |
| "forbid a commit footer" / "footer must be empty" | `'footer-empty': [2, 'always']` | Same logic as body-empty. `'always'` = enforce emptiness. Default in `config-conventional` is `[2, 'never']` — must override. |
| "lowercase subject only" | `'subject-case': [2, 'always', 'lower-case']` | `config-conventional` uses `[2, 'never', ['sentence-case','start-case','pascal-case','upper-case']]` (blocks uppercased styles, but still allows lower or camel). Replace with `[2, 'always', 'lower-case']` to require lowercase strictly. |
| "restrict allowed types" | `'type-enum': [2, 'always', ['feat','fix','chore',...]]` | `'always'` + condition "type is found in value" = type must be in the list. Inherits the default list from `config-conventional`; override with a custom array in `rules`. |
| "type must be lowercase" | `'type-case': [2, 'always', 'lower-case']` | Already set by `config-conventional`. Only add if not extending it. |
| "subject must not be empty" | `'subject-empty': [2, 'never']` | `'never'` negates the `subject-empty` condition → subject required. Already set by `config-conventional`. |
| "wire husky to run commitlint on commit-msg" | `.husky/commit-msg` file containing one line | File content: `npx --no -- commitlint --edit $1`. The `$1` is the path to the temp file holding the message (passed by git). No shebang needed in husky v9. |
| "install husky once for a workspaces monorepo" | `"prepare": "husky"` in root `package.json` | Run `npx husky init` once at the repo root to create `.husky/` and the prepare script. Never run `husky install` — that's the v8 command. All packages share the root `.husky/`. |
| "make pre-commit run check:fast at the root" | `.husky/pre-commit` file containing `npm run check:fast` | Root `check:fast` script uses `npm run check:fast --workspaces --if-present` to fan out. lint-staged can wrap this so ESLint/Prettier only touch staged files. |
| "make pre-push run slow tests" | `.husky/pre-push` file containing `npm run check:slow` | Root `check:slow` fans out via `--workspaces --if-present`; packages without `check:slow` are silently skipped. |
| "extend config-conventional and add overrides" | `extends: ['@commitlint/config-conventional']` + `rules: {...}` | `rules` in your config are merged on top of the extended config. Overriding a rule replaces the entire tuple — you can't partially update level/applicable/value. |
| "test a commit message without committing" | `echo "feat(scope): msg" \| npx commitlint --default-config` | Use `npx commitlint --from HEAD~1 --to HEAD --verbose` to lint the last real commit. |

---

## The Alfred Project Config

This is the exact `commitlint.config.ts` that implements the project's stricter rules. Every line is derived from source-verified rule semantics:

```typescript
// commitlint.config.ts (repo root)
import type { UserConfig } from '@commitlint/types';

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // REQUIRED: scope must be present — e.g., feat(backpressure): ...
    // 'never' negates the scope-empty condition → scope must NOT be empty
    'scope-empty': [2, 'never'],

    // FORBIDDEN: no body — one-line commits only
    // 'always' enforces the body-empty condition → error if body has content
    'body-empty': [2, 'always'],

    // FORBIDDEN: no footer — one-line commits only
    // 'always' enforces the footer-empty condition → error if footer has content
    'footer-empty': [2, 'always'],

    // REQUIRED: subject must be lowercase
    // Replaces config-conventional's 'never' + array with 'always' + single case
    'subject-case': [2, 'always', 'lower-case'],

    // REQUIRED: scope must be lower-case — lowercase letters, digits and hyphens are
    // all fine (e.g. `e2e`, `back-pressure`). Deliberately NOT 'kebab-case': see gotcha.
    'scope-case': [2, 'always', 'lower-case'],
  },
};

export default config;
```

**Allowed commit format:**
```
<type>(<scope>): <lowercase subject>
```
Example: `feat(backpressure): add queue depth metric`

**Disallowed:**
```
feat: missing scope          ← scope-empty violation
feat(api): Has Uppercase     ← subject-case violation
feat(api): has body\n\ndetail← body-empty violation
```

### Types (inherited from @commitlint/config-conventional)
`build` | `chore` | `ci` | `docs` | `feat` | `fix` | `perf` | `refactor` | `revert` | `style` | `test`

---

## Hook Lifecycle (commit-msg / pre-commit / pre-push)

Git fires hooks in this sequence for `git commit`:

1. **pre-commit** — runs before the editor opens; used for fast staged-file checks (lint, format). Abort with exit 1.
2. **commit-msg** — runs after the user types the message; receives the temp file path as `$1`. commitlint reads the file via `--edit $1`. Abort with exit 1.
3. **post-commit** — not used in alfred.

For `git push`:

4. **pre-push** — runs before objects are transferred to the remote. Used for slow checks (type-check, build, Playwright).

**Alfred hook file contents:**

```shell
# .husky/commit-msg
npx --no -- commitlint --edit $1
```

```shell
# .husky/pre-commit
npm run check:fast
```

```shell
# .husky/pre-push
npm run check:slow
```

Hook files have no shebang — husky v9 runs them via `sh` by default.

**CI skip pattern** (GitHub Actions):
```yaml
env:
  HUSKY: 0   # prevents husky from running on CI workers
```

---

## Common Pitfalls

**Rule tuples:**
- Always read the rule's condition name first before choosing `'always'` vs `'never'`. `body-empty` + `'always'` = forbid body. `body-empty` + `'never'` = require body. Swapping them produces the opposite of what you intend with no obvious error at config-parse time.
- Never partially update a tuple. `'subject-case': [2, 'always', 'lower-case']` replaces the entire `config-conventional` entry — you can't inherit the level and only change the value.

**scope-empty is not in config-conventional.** The default `@commitlint/config-conventional` does not include `scope-empty`. If you extend it and forget to add `'scope-empty': [2, 'never']`, scope is optional even if you think the parent config handles it.

**body-empty and footer-empty default to `'never'` in config-conventional** — meaning the base config REQUIRES a body and footer. Alfred's overrides flip this to `[2, 'always']` to forbid them. Any commit with a blank line followed by content will fail if these overrides are missing.

**`scope-case` is `'lower-case'`, NOT `'kebab-case'`.** commitlint's `kebab-case` check runs the scope through `lodash.kebabCase`, which inserts boundaries between letters and digits — so `kebabCase('e2e') === 'e-2-e'` and a scope of `e2e` (or `web3`, `oauth2`, …) is **rejected** with "scope must be kebab-case", demanding the absurd `e-2-e`. `lower-case` only checks `scope === scope.toLowerCase()`, so it accepts `e2e` and `back-pressure` alike while still rejecting `camelCase`/`PascalCase`/`UPPER`. The casing we actually care about is "not uppercased"; digit-as-boundary was never the intent. (This is the casing we want for scopes; subject already uses `lower-case` for the same reason.)

**husky v9 hook files are plain shell — no shebang required** but they must be executable. If `git commit` throws `permission denied` on a hook, run `chmod +x .husky/commit-msg`.

**Never use `git commit --no-verify` or `git push --no-verify`** in alfred. This is a hard project rule. If hooks fail, fix the root cause — don't bypass the hooks. The **only** sanctioned `--no-verify` is inside the `batch-commits` skill's tool, which runs `check:fast` once for the whole batch and validates every message with commitlint up front before skipping the *redundant* per-commit re-runs (see `.claude/skills/batch-commits/SKILL.md`).

**`npx husky init` vs `npx husky install`:** Only `npx husky init` is correct for v9. `npx husky install` is the v8 command and will error or produce a deprecation warning in v9. `npx husky init` creates `.husky/`, adds the `prepare` script, and writes a sample `pre-commit`. Run it once at the repo root; never run it per-workspace.

**commit-msg hook must be named exactly `commit-msg`** — not `commitlint`, not `commit_msg`. Git fires hooks by exact filename.

**lint-staged path routing:** If you add lint-staged to pre-commit, configure it at the root with glob patterns that route to the correct package. Staging a file in `frontend/` and running an ESLint config from `workers/` silently produces wrong results.

---

## Version Gotchas

### husky v9 (released 2024-01-07)

Agents trained before early 2024 will generate the **old v4–v8 patterns**. Reject all of these:

| Old (v4–v8) — DO NOT USE | New (v9) |
|---|---|
| `"prepare": "husky install"` | `"prepare": "husky"` |
| `npx husky add .husky/commit-msg "..."` | `echo "..." > .husky/commit-msg` (or create file manually) |
| Hook files starting with `#!/usr/bin/env sh\n. "$(dirname -- "$0")/_/husky.sh"` | Plain commands, no shebang boilerplate needed |
| `HUSKY_GIT_PARAMS` in hook content | Native `$1`, `$2` shell parameters |
| `HUSKY_SKIP_HOOKS=1` | `HUSKY=0` |
| `commitlint -E HUSKY_GIT_PARAMS` | `commitlint --edit $1` |

The husky v8 hook header `#!/usr/bin/env sh\n. "$(dirname -- "$0")/_/husky.sh"` was required for v8 and should not appear in v9 hook files. Agents will often generate this boilerplate — delete it.

### commitlint TypeScript config (v19+)

`commitlint.config.ts` is supported natively as of commitlint v19. Use `import type { UserConfig } from '@commitlint/types'` for type safety. For older versions use `commitlint.config.cjs` with `module.exports = { ... }`.

---

## What Was Deliberately Left Out

- **`scope-enum`** — commitlint supports enumerating exact allowed scope values. Alfred doesn't restrict scopes to an enum; scope is free-form as long as it's present.
- **`@commitlint/cz-commitlint` / commitizen** — interactive commit prompt tooling. Alfred uses raw `git commit` + hook validation; no interactive prompt is needed.
- **CI-side linting** (`commitlint --from ... --to ...` in GitHub Actions) — the hooks catch issues locally. Adding a CI pass is possible but out of scope for this skill.
- **`parserPreset` customization** — `config-conventional` already sets the correct parser (`conventional-changelog-conventionalcommits`). Changing it would require aligning the Conventional Commits parser options, which has no current use case in alfred.
- **Breaking-change footer syntax** — the project rule is "footer always empty," so `BREAKING CHANGE:` footers are incompatible with alfred's config by design. Use `!` in the type/scope instead: `feat(api)!: rename endpoint`.
- **Pre-v9 husky setup details** — fully documented in `husky/docs/migrate-from-v4.md` in the repo. Not included here because using old patterns in alfred would be a bug.
- **lint-staged full config reference** — covered in the alfred npm-workspaces skill if needed.
