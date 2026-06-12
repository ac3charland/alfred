import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import importPlugin from 'eslint-plugin-import';
import jestPlugin from 'eslint-plugin-jest';
import jestDomPlugin from 'eslint-plugin-jest-dom';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import playwrightPlugin from 'eslint-plugin-playwright';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import storybookPlugin from 'eslint-plugin-storybook';
import testingLibrary from 'eslint-plugin-testing-library';
import unicornPlugin from 'eslint-plugin-unicorn';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  // ── Global ignores ──────────────────────────────────────────────────────
  {
    ignores: [
      '.next/**',
      'dist/**',
      'out/**',
      'coverage/**',
      'storybook-static/**',
      'playwright-report/**',
      'test-results/**',
      // Stryker mutation testing — transient sandbox copy of source (never lint)
      '.stryker-tmp/**',
      '*.gen.ts',
      'node_modules/**',
      // Visual-regression baselines — generated PNGs (npm run test:storybook:update)
      '__image_snapshots__/**',
      // Next.js generated file — do not lint
      'next-env.d.ts',
      // Supabase-generated schema types (regenerated via `supabase gen types`)
      'lib/database.types.ts',
    ],
  },

  // ── Base JS rules ────────────────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript + type-aware rules ────────────────────────────────────────
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Allow files not picked up by tsconfig.json's project service:
          // .storybook/ TS files, scripts/, and root-level config JS/MJS files.
          allowDefaultProject: [
            '.storybook/*.ts',
            '.storybook/*.tsx',
            'scripts/*.mjs',
            '*.mjs',
            '*.cjs',
            '*.js',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Import validation ────────────────────────────────────────────────────
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    settings: {
      'import/resolver': {
        typescript: true,
        node: true,
      },
    },
  },

  // ── Unicorn anti-patterns ─────────────────────────────────────────────────
  unicornPlugin.configs.recommended,
  {
    rules: {
      // alfred is a Postgres/Supabase app: `null` is the canonical absent value at the
      // data boundary, and it shows up EVERYWHERE — the generated DB types are `T | null`,
      // rows render with null fields, `.is(col, null)` generates SQL `IS NULL`, clearing a
      // column / test fixtures all require literal `null`. The strict TYPES (`T | null` vs
      // `T | undefined`) already enforce correct nullability; `unicorn/no-null` was redundant
      // and, worse, repeatedly pushed agents toward an `undefined as unknown as null` hack
      // that BREAKS at runtime. Deliberate project decision: off globally. (By convention,
      // still prefer `undefined` for purely-UI absent state, e.g. React `useState`.)
      'unicorn/no-null': 'off',
      // `unicorn/prevent-abbreviations` fights established ecosystem conventions far more
      // than it helps: it pushes `utils` → `utilities` (shadcn/ui ships `lib/utils.ts` and
      // its CLI writes that path), `env`/`props`/`params`/`ref`/`dir` → verbose forms, etc.
      // The renames actively cut against the grain of the libraries we use. Deliberate
      // project decision: off globally. Clear, conventional names are reviewed by humans.
      'unicorn/prevent-abbreviations': 'off',
    },
  },

  // ── Project rule tuning ───────────────────────────────────────────────────
  {
    rules: {
      // Honor the `_`-prefix convention for deliberately-unused bindings: unused
      // function args, caught errors, destructured-array holes, and locals. This
      // mirrors TypeScript's own `noUnusedParameters`, which already exempts
      // `_`-prefixed params, so compiler and linter agree. `args: 'all'` means a
      // leading unused arg must be `_`-prefixed to be intentional — the prefix is
      // the marker, not silently ignored.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // ── React ─────────────────────────────────────────────────────────────────
  {
    files: ['**/*.{jsx,tsx}'],
    ...reactPlugin.configs.flat.recommended,
    ...reactPlugin.configs.flat['jsx-runtime'],
    settings: {
      react: { version: 'detect' },
    },
    languageOptions: {
      ...reactPlugin.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
      },
    },
  },
  reactHooks.configs.flat['recommended-latest'],

  // ── Next.js ────────────────────────────────────────────────────────────────
  nextPlugin.configs['core-web-vitals'],

  // ── Accessibility ──────────────────────────────────────────────────────────
  jsxA11y.flatConfigs.recommended,

  // ── Storybook (stories files only) ────────────────────────────────────────
  // flat/recommended exports an array of config objects (plugin, stories rules,
  // story-type rules). Spread it directly — each item already scopes to the
  // correct files globs internally.
  ...storybookPlugin.configs['flat/recommended'],

  // ── Storybook stories: allow empty stub functions ─────────────────────────
  // Stories routinely need inert no-op callback props (e.g. `onConfirm={() => {}}`).
  // These are fixtures, not logic — `@typescript-eslint/no-empty-function` would
  // otherwise force kludgey named stubs with throwaway `return;` bodies. Scoped to
  // story files only; real source keeps the rule. (To *assert* a callback fired,
  // use `fn()` from `'storybook/test'` instead of an empty stub.)
  {
    files: ['**/*.stories.{ts,tsx}', '**/*.story.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
    },
  },

  // ── Jest + Testing Library + jest-dom (test files only, excluding e2e) ─────
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    ignores: ['e2e/**', 'tests/**'],
    ...jestPlugin.configs['flat/recommended'],
    ...jestDomPlugin.configs['flat/recommended'],
    ...testingLibrary.configs['flat/react'],
    rules: {
      // Tests routinely need never-resolving promise executors and other inert
      // stubs (e.g. `new Promise(() => {})`). These are intentional test
      // harness patterns — `@typescript-eslint/no-empty-function` adds noise
      // without safety benefit in test files.
      '@typescript-eslint/no-empty-function': 'off',
    },
  },

  // ── Playwright (e2e test files only) ──────────────────────────────────────
  {
    files: ['e2e/**', 'tests/**', '**/*.e2e.ts'],
    ...playwrightPlugin.configs['flat/recommended'],
    rules: {
      ...playwrightPlugin.configs['flat/recommended'].rules,
    },
  },

  // ── JS/CJS/MJS config files: no type-aware linting (not in tsconfig) ───────
  {
    files: ['**/*.{js,cjs,mjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // Add Node.js globals (process, require, module, __dirname, etc.)
      // so plain JS/CJS/MJS scripts don't get `no-undef` false positives.
      globals: {
        ...globals.node,
      },
    },
  },

  // ── Config-file-only: silence false positives ────────────────────────────
  // 1. typescript-eslint's `import tseslint` usage trips import/no-named-as-default-member
  //    (the module also has a named `configs` export). Correct usage; disable for config files.
  // 2. CJS config files (e.g. test-runner-jest.config.js) need require() — disable for .cjs/.js.
  {
    files: ['**/*.{js,cjs,mjs}'],
    rules: {
      'import/no-named-as-default-member': 'off',
    },
  },
  {
    files: ['**/*.{js,cjs}'],
    rules: {
      // CJS require() / module.exports are valid in plain .js/.cjs config files.
      // unicorn/prefer-module wants ESM everywhere, but some tooling (jest configs)
      // must remain CJS — use .cjs extension to signal intent and scope the rule off.
      '@typescript-eslint/no-require-imports': 'off',
      'unicorn/prefer-module': 'off',
    },
  },

  // ── Ambient declaration files (.d.ts) ─────────────────────────────────────
  // These use conventional short filenames (e.g. `env.d.ts`) — the filename-case
  // rule doesn't apply to type-contract files. (Scoped off only here; real source
  // keeps the rule.)
  {
    files: ['**/*.d.ts'],
    rules: {
      'unicorn/filename-case': 'off',
    },
  },

  // ── Prettier must be last ─────────────────────────────────────────────────
  eslintConfigPrettier,
]);
