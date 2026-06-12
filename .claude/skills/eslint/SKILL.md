---
name: eslint
description: >
  Covers ESLint, Prettier, and import sorting: ESLint 9 flat config
  (eslint.config.js), typescript-eslint strict/type-aware rules, per-package plugin scoping
  (frontend/ vs workers/), eslint-config-prettier integration, and @trivago/prettier-plugin-sort-imports.
  Use when creating or editing eslint.config.js or prettier.config.js, adding a lint plugin, changing
  a rule severity, scoping rules to test files, or running check:fast. Do NOT use for Jest test
  authoring (use the jest skill) or Next.js routing (use the nextjs skill).
---

# ESLint + Prettier Skill (alfred monorepo)

## Mental Model

ESLint 9 flat config is an **ordered array of config objects** exported from `eslint.config.js`.
Each object can carry `files` (glob), `plugins`, `rules`, `languageOptions`, and `settings`.
ESLint processes every object whose `files` glob matches the target file; later objects override
earlier ones for the same rule key. This means:

1. **Order matters**: spread broad base configs first, narrow overrides last, `eslint-config-prettier`
   absolutely last (it turns off formatting rules that would conflict with Prettier).
2. **Type-aware linting requires a TypeScript program.** The `@typescript-eslint` parser must
   resolve a `tsconfig.json` — use `parserOptions.projectService: true` (typescript-eslint v8+,
   recommended). It delegates to TypeScript Language Service, the same service VS Code uses, so
   it automatically follows project references. The older `parserOptions.project` still works but
   requires explicit path(s) and is slower.
3. **ESLint lints; Prettier formats.** Never enable Prettier as an ESLint rule
   (`eslint-plugin-prettier`) — that turns format failures into lint errors and is slow. Instead,
   run `eslint --fix` then `prettier --cache` separately. `eslint-config-prettier` disables the
   ESLint rules that would otherwise fight Prettier.
4. **Plugin key names are arbitrary in flat config.** In `plugins: { unicorn: unicornPlugin }` the
   key `unicorn` is the rule-prefix you use in rules (`'unicorn/no-null'`). Match the conventional
   namespace to avoid confusion.
5. **The alfred philosophy: `error` not `warn`.** Warnings are noise; everything actionable must
   be `error`. Never weaken a rule to make a failing file pass — fix the code instead.
6. **If a rule (or a *combination* of rules) genuinely doesn't fit a context, file a lint
   suggestion — don't silently work around it.** Make the code pass the gate as it stands, then
   add one markdown file describing the issue and a concrete suggested change to the inbox at
   `docs/lint-suggestions/` (see its `README.md`), the same turn you hit the friction. A
   deliberate, scoped rule change (like a `files`-scoped override) is a *separate, reviewed*
   task — never an ad-hoc reaction to a red check. The two changes this repo already made
   (`_`-prefixed unused vars; empty stubs in stories) came from exactly this kind of friction.

> Source: ESLint team, "New Config System, Part 2: Introduction to Flat Config", eslint.org/blog, 2022
> Source: typescript-eslint team, "Announcing typescript-eslint v8", typescript-eslint.io/blog, 2024
> Source: typescript-eslint team, "Typed Linting with Project Service", typescript-eslint.io/blog, 2024

---

## Decision Tree

**Is this the `frontend/` or the `workers/` package?**

- `frontend/` → Full stack: TS + React/Next/JSX a11y + Testing Library + Storybook + Playwright
- `workers/` → Lean stack: TS + import + unicorn + Jest only (no React, no Storybook, no Playwright)

**Do you need type-aware rules (e.g., `strict-type-checked`)?**
→ Yes (all TS packages in alfred) → Set `parserOptions.projectService: true` and `tsconfigRootDir`.
→ Only JS files → Use `recommended` without type-checked variants.

**Do you need to scope a plugin to test files only?**
→ Yes → Add a separate config object with `files: ['**/*.test.ts', '**/*.spec.ts', 'tests/**']`
   and spread the test plugin there — don't add test-only rules globally.

**Should a rule fire as `warn` or `error`?**
→ Always `error`. The alfred project never uses `warn`. See Common Pitfalls.

**Do I need `FlatCompat` for a legacy plugin?**
→ Only if the plugin doesn't export `flatConfigs.*` or `configs['flat/...']`. Check the plugin's
   README first — most current plugins support flat config natively as of 2024-2025.

---

## Plain-English → Pattern Table

| When the user says… | Use this pattern | Key things to know |
|---|---|---|
| "Set up flat config for a TS package with type-aware rules" | `eslint.config.js` with `tseslint.configs.strictTypeChecked` + `tseslint.configs.stylisticTypeChecked`; `parserOptions.projectService: true` | Must also set `tsconfigRootDir: import.meta.dirname`. Skipping `projectService` makes type-aware rules silently produce no errors. |
| "Add the frontend-only React/Next plugins" | `reactPlugin.configs.flat.recommended` + `reactPlugin.configs.flat['jsx-runtime']` + `reactHooks.configs.flat['recommended-latest']` + `nextPlugin.flatConfig.coreWebVitals` + `jsxA11y.flatConfigs.recommended` | Always add `settings: { react: { version: 'detect' } }`. Use `recommended-latest` for react-hooks (not `recommended` — the old key uses a string array incompatible with ESLint 9). |
| "Scope plugins to test files only" | Separate config object: `{ files: ['**/*.test.ts', '**/*.spec.ts'], ...jest.configs['flat/recommended'] }` | Spread `...plugin.configs['flat/recommended']` inside the object with `files`. Do NOT add test plugins globally — they flag non-test code. |
| "Configure Prettier with single quotes and import sorting" | `prettier.config.js` (or `.prettierrc.js`) with `singleQuote: true`, `tabWidth: 2`, `plugins: ['@trivago/prettier-plugin-sort-imports']`, `importOrder: [...]`, `importOrderSeparation: true`, `importOrderSortSpecifiers: true` | Plugin must be listed in `plugins` array. The order of entries in `importOrder` is the sort order; third-party modules not matched by any regex are grouped at the top by default. |
| "Make ESLint defer formatting to Prettier" | Spread `eslintConfigPrettier` as the last item in the config array | Import from `"eslint-config-prettier/flat"`. Placing it anywhere but last means a later config object can re-enable conflicting rules. |
| "Add eslint-plugin-import for import validation and ordering" | `importPlugin.flatConfigs.recommended` + `importPlugin.flatConfigs.typescript`; install `eslint-import-resolver-typescript` | Add `settings: { 'import/resolver': { typescript: true, node: true } }` to make resolver find `.ts`/`.tsx` files. The `flatConfigs.typescript` entry as of early 2025 may be missing `typescript: true` in settings — verify and add manually if import resolution fails. |
| "Add eslint-plugin-unicorn for anti-pattern rules" | `unicornPlugin.configs.recommended` | Requires ESLint ≥ 9.20.0 and ESM. If the package uses CJS, disable `unicorn/prefer-module` in an override. The recommended config enables 100+ rules; override individual ones with `'error'` if you want to tighten or `'off'` to remove. |
| "Lint a Cloudflare Worker package" | Same base as frontend but drop React/Next/JSX a11y/Storybook/Playwright/Testing Library; keep TS + import + unicorn + Jest | `workers/` has no browser DOM globals. Set `languageOptions.globals` to `globals.node` or the appropriate CF Workers global set instead of `globals.browser`. |
| "Add Storybook lint rules" | `...storybook.configs['flat/recommended']` | This is an array — spread with `...`. Scope with `files: ['**/*.stories.{ts,tsx}', '**/*.story.{ts,tsx}']` to avoid story-rule false positives in app code. |
| "Add Playwright lint rules" | `{ files: ['tests/**', 'e2e/**'], ...playwright.configs['flat/recommended'], rules: { ...playwright.configs['flat/recommended'].rules } }` | Must duplicate `.rules` inside the object when adding `files` scoping alongside the spread — otherwise `files` from the plugin config wins. |
| "Ignore generated files and build output" | Top-level config object: `{ ignores: ['.next/**', 'dist/**', 'node_modules/**', '*.gen.ts'] }` | `ignores` without a `files` key is a global ignore. Never use `.eslintignore` — it's a legacy eslintrc concept. |
| "Run lint with auto-fix and cache" | `eslint --fix --cache --cache-location .eslintcache` | The `--cache` flag skips unchanged files. In `check:fast`, run ESLint first (fix), then Prettier (`prettier --write --cache`). |

---

## Common Pitfalls

- **Never use `warn` for any rule**. Set all actionable rules to `error`. `warn` exits 0 — CI passes, the problem is ignored.
- **Never add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `// prettier-ignore`** to force a pass. Fix the code.
- **Never spread a plugin config and then re-declare `plugins`** in the same object without merging — the second `plugins` key silently overwrites the first in plain object spread.
- **Always place `eslint-config-prettier` last**. Any config object after it can re-enable formatting rules that conflict with Prettier.
- **Always set `tsconfigRootDir: import.meta.dirname`** when using `projectService`. Without it, the path resolution is relative to the process CWD, which breaks when ESLint is run from the monorepo root.
- **Never enable `eslint-plugin-prettier`** (the plugin that runs Prettier as a lint rule). It's slow and creates circular rule conflicts. Use `eslint-config-prettier` (the config that *disables* conflicting rules) instead.
- **Never import from `eslint-config-prettier` without the `/flat` suffix** in ESLint 9 flat config. The default export is a legacy format object that lacks a `name` property; `/flat` is the correct entry point.
- **Always add `settings: { react: { version: 'detect' } }`** when using `eslint-plugin-react`. Without it, the plugin emits a warning on every run about not being able to detect the React version.
- **Never omit `importPlugin.flatConfigs.typescript`** in TS packages. Without it, the import resolver doesn't know about `.ts`/`.tsx` extensions and reports false "module not found" errors.
- **Unicorn requires ESM** (`"type": "module"` in `package.json` or `.mjs` config file). If your `eslint.config.js` is CommonJS, unicorn's flat config will fail to import.
- **`tseslint.config()` is now deprecated** in favor of `defineConfig` from `eslint/config` (as of 2025 ESLint blog). Either still works; avoid mixing them.
- **`as T` for a non-null cast collides with `no-non-null-assertion`.** `eslint --fix` rewrites `value as ItemNode` (when the only difference is nullability) into `value!` via `@typescript-eslint/non-nullable-type-assertion-style`, but `@typescript-eslint/no-non-null-assertion` then **errors** on that `!`. Don't fight it with a disable — narrow instead. In tests, a tiny helper does it: `function defined<T>(v: T \| undefined): T { if (v === undefined) throw new Error('expected'); return v }`, then `defined(arr[0])`. (See `lib/tree.test.ts`, `lib/stores/tasks-store.test.tsx`.)
- **`react-hooks/refs` (recommended-latest) forbids writing `ref.current` during render.** A `ref.current = state` in the component body errors. Sync the ref in an effect: `useEffect(() => { ref.current = state }, [state])` — see the optimistic stores in `lib/stores/*`.

---

## Version Gotchas

**ESLint 9 (released April 2024) — flat config is now the DEFAULT**

- **`.eslintrc.*` files are legacy and auto-ignored** in ESLint 9. An agent trained on pre-v9 examples will generate `.eslintrc.js` with `extends: [...]` strings — this is wrong. The correct file is `eslint.config.js` (or `.mjs`/`.cjs`) exporting a **plain array**.
- **`extends` strings inside config objects don't exist in flat config.** In eslintrc you wrote `extends: ['plugin:@typescript-eslint/strict']`. In flat config you **import** the plugin and **spread** its exported config object into the array.
- **`env` is gone.** Replace `env: { browser: true }` with `languageOptions: { globals: globals.browser }` using the `globals` npm package.
- **`parser` moved.** Replace `parser: '@typescript-eslint/parser'` with `languageOptions: { parser: tseslint.parser }`.
- **`overrides` is replaced by additional array entries with `files` globs.** The flat config array *is* the override mechanism.
- **`plugins` in flat config is an object (`{ unicorn: unicornPlugin }`), not an array of strings.** Agents trained on legacy configs will write `plugins: ['unicorn']` — this throws.

**typescript-eslint v8 (2024)**

- `parserOptions.EXPERIMENTAL_useProjectService` was renamed to `parserOptions.projectService`. Old configs using the experimental key will silently fall back to non-typed linting.
- `strictTypeChecked` and `stylisticTypeChecked` are the v6+ names. The v5 names were `strict` and `stylistic` without type-checked variants — using the old names gives you fewer rules.

**eslint-plugin-react-hooks v5**

- Use `reactHooks.configs.flat['recommended-latest']` for ESLint 9. The `recommended` key uses an array-format `plugins` field incompatible with flat config and will throw.

**@trivago/prettier-plugin-sort-imports**

- Must be listed in the `plugins` array in prettier config (not installed and auto-discovered). Without explicit registration it does nothing silently.

**`@next/eslint-plugin-next` flat config API**

- The skill template showed `nextPlugin.flatConfig.coreWebVitals` — this path does NOT exist in the actual package (confirmed v16.2.7). The correct access is `nextPlugin.configs['core-web-vitals']`. Check available keys with `Object.keys(nextPlugin.configs)` — they are `'recommended-legacy'`, `'core-web-vitals-legacy'`, `'recommended'`, and `'core-web-vitals'`. Use `nextPlugin.configs['core-web-vitals']` for the Next.js flat-config entry.

**`unicorn/prevent-abbreviations` is OFF project-wide (deliberate decision)**

- This rule is disabled in both `frontend/` and `workers/` configs (in the unicorn rule-tuning block, alongside `unicorn/no-null`). It forced ecosystem-hostile renames — `utils` → `utilities` (shadcn/ui ships `lib/utils.ts` and its CLI writes that path), `env`/`props`/`params` → verbose forms — that cut against the grain of the libraries the project uses. **Do not re-enable it**, and do not rename identifiers to "fix" abbreviations.
- `next-env.d.ts` (Next.js generated, at the package root) stays in the global `ignores` array — but because it is *generated output we never lint*, not because of this rule.

**TypeScript config files outside `tsconfig.json` include with `allowDefaultProject`**

- TS files not matched by `tsconfig.json`'s `include` globs (e.g. `.storybook/*.ts`) trigger: *"was not found by the project service"*. Fix: `projectService: { allowDefaultProject: ['.storybook/*.ts', '.storybook/*.tsx'] }`. Wildcards like `*.mjs` match root-level files only; subdirectories need explicit patterns (`scripts/*.mjs`).
- **Every file routed through the default project counts toward typescript-eslint's cap (8).** Exceed it and lint fails hard: *"Too many files (>8) have matched the default project … known to cause performance issues."* Adding one more config/script file (a 9th) is enough to trip it. **Do NOT raise `maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING`** — the flag name says it slows linting; that's weakening the guardrail. Fix it by keeping non-TS files *out* of the default project entirely (next bullet), so only the handful of `.storybook/*.ts` files remain.
- **The `disableTypeChecked` block's `projectService: false` does NOT override an earlier object `projectService` — ESLint deep-merges `parserOptions`, so the object wins** (and `allowDefaultProject: [...]` even gets mangled into an indexed `{0:…,1:…}`). So a globally-unscoped `projectService: {…}` block silently routes JS/CJS/MJS files through the default project despite the `disableTypeChecked` override. Fix: scope the type-aware `projectService` block to TS files — `files: ['**/*.{ts,tsx,mts,cts}']` — so JS/CJS/MJS files resolve to `false` cleanly and drop out of the default-project count. Verify with `npx eslint --print-config <file.mjs>`: `parserOptions.projectService` must be absent/`false`, not an object.

**Scoping Jest/RTL rules to exclude E2E test files**

- The glob `**/*.spec.{ts,tsx}` matches both Jest component specs AND Playwright E2E files (`e2e/home.spec.ts`). Applying Jest/RTL rules to Playwright tests produces false `testing-library/prefer-screen-queries` errors. Fix: add `ignores: ['e2e/**', 'tests/**']` inside the Jest config object alongside `files`:
  ```js
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    ignores: ['e2e/**', 'tests/**'],
    ...jestPlugin.configs['flat/recommended'],
    ...testingLibrary.configs['flat/react'],
  }
  ```

**`unicorn/no-array-reduce` + `unicorn/no-array-sort` + `toSorted` circular constraint**

When you have both `unicorn/no-array-sort` (forbids `.sort()`) AND `unicorn/no-array-reduce` (forbids `.reduce()`), and `tsconfig` targets ES2022 (so `toSorted` is not in the lib), you get a circular constraint: can't use `.sort()`, can't use `.reduce()`, can't use `.toSorted()`. The escape hatch is an explicit insertion-sort `for` loop:

```ts
const sorted: T[] = [];
for (const item of items) {
  const insertAt = sorted.findIndex((existing) => compare(existing, item) > 0);
  if (insertAt === -1) sorted.push(item);
  else sorted.splice(insertAt, 0, item);
}
```

This creates a new array (satisfies `.sort()` mutation concern) using a loop (not `.reduce()`) and works in ES2022 (no `toSorted` needed).

**`unicorn/prefer-ternary` on `if/else` with `await`**

When a function has an `if/else` where both branches `await` different things, ESLint's `unicorn/prefer-ternary` wants them collapsed to `await (condition ? a() : b())`. This is valid TypeScript and works:

```ts
// Before — triggers unicorn/prefer-ternary
if (cond) await foo();
else await bar();

// After — compiles fine, no lint error
await (cond ? foo() : bar());
```

**CJS config files (`.cjs`): `require`/`module` need two rule disables**

- Plain CJS config files (e.g. `test-runner-jest.config.cjs`) need two rule overrides to avoid false positives:
  1. `@typescript-eslint/no-require-imports: 'off'` — typescript-eslint strict mode forbids `require()` style imports
  2. `unicorn/prefer-module: 'off'` — unicorn wants all files to be ESM

- Scope both via `files: ['**/*.{js,cjs}']` override. Use `.cjs` extension for Jest configs that must remain CJS — the extension signals intent and lets you target the override precisely.

- Never use `.js` for a CJS config when the project has `"type": "module"` in `package.json` — Node treats `.js` files as ESM in that context and CJS `require()` will throw at runtime. Use `.cjs` extension explicitly.

**Node.js globals for `.mjs` and `.cjs` scripts**

- ESLint's `no-undef` fires for `process`, `require`, `module`, `__dirname` in script files when no `languageOptions.globals` is set. Fix: add `globals.node` to the override for all non-TS script files:
  ```js
  {
    files: ['**/*.{js,cjs,mjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node } },
  }
  ```

> Source: ESLint team, "Migrate to ESLint 9.x", eslint.org/docs, 2024
> Source: typescript-eslint team, "Announcing typescript-eslint v8", typescript-eslint.io/blog, 2024
> Source: eslint-plugin-react-hooks GitHub issue #28313, facebook/react, 2024

---

## Full Assembly Reference

See [`references/configs.md`](./references/configs.md) for:
- Complete `eslint.config.js` template for `frontend/`
- Complete `eslint.config.js` template for `workers/`
- Complete `prettier.config.js` template

---

## What's Not in This Skill (and Why)

- **eslint-plugin-prettier** — intentionally excluded; the alfred project runs ESLint and Prettier separately. Including it here would create confusion about the two-tool split.
- **FlatCompat / `@eslint/eslintrc`** — excluded; all plugins used in alfred have native flat config support. FlatCompat is a migration crutch for unmaintained plugins.
- **`parserOptions.project` (explicit paths)** — `projectService: true` is the current recommendation. Explicit paths are still valid for edge cases but not needed here.
- **eslint-plugin-n (Node.js rules)** — not part of the alfred stack. Workers use Cloudflare's runtime, not Node.
- **Rule-by-rule documentation** — the 100+ unicorn rules and 80+ typescript-eslint rules are not enumerated. Consult `typescript-eslint.io/rules` and the unicorn GitHub README for the full rule list.
- **eslint-config-next (shareable config)** — the alfred setup uses `@next/eslint-plugin-next` directly via `nextPlugin.flatConfig.coreWebVitals`. The higher-level `eslint-config-next` wraps it but is harder to compose in flat config without duplication.
