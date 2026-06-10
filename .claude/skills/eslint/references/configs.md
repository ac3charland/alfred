# ESLint + Prettier Config Templates

Complete, copy-pasteable templates for the alfred monorepo packages.
All examples use ES modules (`"type": "module"` in package.json or `.mjs` suffix).

---

## `frontend/eslint.config.js`

```js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import jestPlugin from 'eslint-plugin-jest';
import jestDomPlugin from 'eslint-plugin-jest-dom';
import nextPlugin from '@next/eslint-plugin-next';
import playwrightPlugin from 'eslint-plugin-playwright';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import storybookPlugin from 'eslint-plugin-storybook';
import testingLibrary from 'eslint-plugin-testing-library';
import unicornPlugin from 'eslint-plugin-unicorn';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default defineConfig([
  // ── Global ignores ──────────────────────────────────────────────────────
  {
    ignores: [
      '.next/**',
      'dist/**',
      'out/**',
      '*.gen.ts',
      'node_modules/**',
      // Next.js generated file — do not lint
      'next-env.d.ts',
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
        projectService: true,
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
  // NOTE: nextPlugin.flatConfig.coreWebVitals does NOT exist in @next/eslint-plugin-next.
  // The correct path is nextPlugin.configs['core-web-vitals'] (confirmed v16.2.7+).
  nextPlugin.configs['core-web-vitals'],

  // ── Accessibility ──────────────────────────────────────────────────────────
  jsxA11y.flatConfigs.recommended,

  // ── Storybook (stories files only) ────────────────────────────────────────
  {
    files: ['**/*.stories.{ts,tsx}', '**/*.story.{ts,tsx}'],
    ...storybookPlugin.configs['flat/recommended'],
  },

  // ── Jest + Testing Library + jest-dom (test files only) ───────────────────
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    ...jestPlugin.configs['flat/recommended'],
    ...jestDomPlugin.configs['flat/recommended'],
    ...testingLibrary.configs['flat/react'],
  },

  // ── Playwright (e2e test files only) ──────────────────────────────────────
  {
    files: ['tests/**', 'e2e/**', '**/*.e2e.ts'],
    ...playwrightPlugin.configs['flat/recommended'],
    rules: {
      ...playwrightPlugin.configs['flat/recommended'].rules,
    },
  },

  // ── Prettier must be last ─────────────────────────────────────────────────
  eslintConfigPrettier,
]);
```

---

## `workers/eslint.config.js`

```js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import jestPlugin from 'eslint-plugin-jest';
import unicornPlugin from 'eslint-plugin-unicorn';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default defineConfig([
  // ── Global ignores ──────────────────────────────────────────────────────
  {
    ignores: ['dist/**', 'node_modules/**', '*.gen.ts'],
  },

  // ── Base JS rules ────────────────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript + type-aware rules ────────────────────────────────────────
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // allowDefaultProject covers root-level TS files (e.g. jest.config.ts) not
        // included in tsconfig.json's "include": ["src"]. Without this, ESLint errors:
        // "was not found by the project service".
        projectService: {
          allowDefaultProject: ['*.ts', '*.tsx'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        // Cloudflare Workers runtime — no Node, no browser DOM
        ...globals.worker,
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

  // ── Jest (test files only) ────────────────────────────────────────────────
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    ...jestPlugin.configs['flat/recommended'],
  },

  // ── Prettier must be last ─────────────────────────────────────────────────
  eslintConfigPrettier,
]);
```

---

## `prettier.config.js` (root — shared by all packages)

```js
/** @type {import('prettier').Config} */
export default {
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'all',
  semi: true,
  printWidth: 100,
  plugins: ['@trivago/prettier-plugin-sort-imports'],

  // --- @trivago/prettier-plugin-sort-imports options ---
  // importOrder: array of regex strings defining sort groups.
  // Groups are applied in order; anything not matching goes to top (third-party).
  importOrder: [
    // Node built-ins
    '<BUILTIN_MODULES>',
    // Third-party (default bucket — anything not matched below)
    '<THIRD_PARTY_MODULES>',
    // Monorepo internal packages (prefix @ or specific workspace names)
    '^@alfred/(.*)$',
    // Relative imports
    '^[./]',
  ],

  // Add blank lines between each importOrder group
  importOrderSeparation: true,

  // Sort named specifiers within a single import: import { b, a } → { a, b }
  importOrderSortSpecifiers: true,

  // Optional extras (defaults shown):
  // importOrderCaseInsensitive: false,
  // importOrderGroupNamespaceSpecifiers: false,
};
```

### Key @trivago/prettier-plugin-sort-imports options

| Option | Type | Default | Description |
|---|---|---|---|
| `importOrder` | `string[]` | required | Regex patterns for group order. Use `<BUILTIN_MODULES>` and `<THIRD_PARTY_MODULES>` as special tokens. |
| `importOrderSeparation` | `boolean` | `false` | Blank line between groups. |
| `importOrderSortSpecifiers` | `boolean` | `false` | Sort named specifiers alphabetically. |
| `importOrderCaseInsensitive` | `boolean` | `false` | Case-insensitive specifier sort. |
| `importOrderGroupNamespaceSpecifiers` | `boolean` | `false` | Move `* as foo` to top of group. |
| `importOrderParserPlugins` | `string[]` | `["typescript","jsx"]` | Babel parser plugins for syntax. |

> Source: @trivago/prettier-plugin-sort-imports GitHub README, trivago, 2024

---

## Required packages (per workspace)

### Both packages
```
eslint
typescript-eslint
@eslint/js
eslint-plugin-import
eslint-import-resolver-typescript
eslint-plugin-unicorn
eslint-plugin-jest
eslint-config-prettier
globals
prettier
@trivago/prettier-plugin-sort-imports
```

### frontend/ only
```
eslint-plugin-react
eslint-plugin-react-hooks
@next/eslint-plugin-next
eslint-plugin-jsx-a11y
eslint-plugin-jest-dom
eslint-plugin-testing-library
eslint-plugin-storybook
eslint-plugin-playwright
```

---

## `check:fast` script pattern

```json
{
  "scripts": {
    "check:fast": "eslint --fix --cache --cache-location .eslintcache . && prettier --write --cache ."
  }
}
```

Run ESLint (auto-fix) first, then Prettier. Prettier runs second because ESLint
may reformat code in ways Prettier then normalizes — this order avoids a second
ESLint pass.
