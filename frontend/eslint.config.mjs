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

  // ── Jest + Testing Library + jest-dom (test files only, excluding e2e) ─────
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    ignores: ['e2e/**', 'tests/**'],
    ...jestPlugin.configs['flat/recommended'],
    ...jestDomPlugin.configs['flat/recommended'],
    ...testingLibrary.configs['flat/react'],
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

  // ── Prettier must be last ─────────────────────────────────────────────────
  eslintConfigPrettier,
]);
