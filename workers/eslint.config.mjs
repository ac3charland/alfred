import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import importPlugin from 'eslint-plugin-import';
import jestPlugin from 'eslint-plugin-jest';
import unicornPlugin from 'eslint-plugin-unicorn';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
  {
    rules: {
      // `unicorn/prevent-abbreviations` fights established ecosystem conventions
      // (`utils` → `utilities`, `env`/`props`/`params`/`ref` → verbose forms) far
      // more than it helps. Deliberate project decision: off globally, matching
      // the frontend package. Clear, conventional names are reviewed by humans.
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

  // ── Jest (test files only) ────────────────────────────────────────────────
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    ...jestPlugin.configs['flat/recommended'],
  },

  // ── JS/CJS/MJS config files: no type-aware linting (not in tsconfig) ───────
  {
    files: ['**/*.{js,cjs,mjs}'],
    ...tseslint.configs.disableTypeChecked,
  },

  // ── Config-file-only: silence a false positive ────────────────────────────
  // `import tseslint from 'typescript-eslint'` + `tseslint.configs.*` trips
  // import/no-named-as-default-member (a documented false positive). Scope off
  // for config files only; source keeps the rule. Honors the no-warn ethos.
  {
    files: ['**/*.{js,cjs,mjs}'],
    rules: {
      'import/no-named-as-default-member': 'off',
    },
  },

  // ── Prettier must be last ─────────────────────────────────────────────────
  eslintConfigPrettier,
]);
