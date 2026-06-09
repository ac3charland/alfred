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
  },

  // ── Config-file-only: silence a false positive ────────────────────────────
  // typescript-eslint's documented `import tseslint from 'typescript-eslint'` +
  // `tseslint.configs.*` usage trips import/no-named-as-default-member (the module
  // also has a named `configs` export). It's correct usage; scope the rule off for
  // config files only (app/source code keeps the rule). Honors the no-warn ethos.
  {
    files: ['**/*.{js,cjs,mjs}'],
    rules: {
      'import/no-named-as-default-member': 'off',
    },
  },

  // ── Prettier must be last ─────────────────────────────────────────────────
  eslintConfigPrettier,
]);
