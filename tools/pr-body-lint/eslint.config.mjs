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
    // Scope the type-aware project service to TS files ONLY. JS/CJS/MJS config files
    // get `projectService: false` from the disableTypeChecked block below — but
    // ESLint's flat-config deep-merge keeps an *object* `projectService` over a later
    // `false`, so if this block matched them too, that override would silently no-op
    // and every config file would route through the default project (tripping
    // typescript-eslint's >8-default-project-files cap). Scoping by `files` keeps the
    // object off JS files entirely, so their `false` is the only value that resolves.
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parserOptions: {
        projectService: {
          // tsconfig includes only src/; the root jest.config.ts needs the default tsconfig.
          allowDefaultProject: ['*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        // This is a Node CLI — Node globals (process, console, Buffer, …).
        ...globals.node,
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
    rules: {
      // Node's native TypeScript loader resolves *only* explicit `.ts` import
      // specifiers (extensionless imports throw ERR_MODULE_NOT_FOUND), so this
      // package imports local modules as `./foo.ts`. Tell import/extensions that
      // an explicit `.ts` extension is correct here rather than fighting it.
      'import/extensions': ['error', 'ignorePackages', { ts: 'always' }],
    },
  },

  // ── Unicorn anti-patterns ─────────────────────────────────────────────────
  unicornPlugin.configs.recommended,
  {
    rules: {
      // `unicorn/prevent-abbreviations` fights established ecosystem conventions
      // (`utils` → `utilities`, `env`/`args`/`params` → verbose forms) far more
      // than it helps. Deliberate project decision: off globally, matching the
      // frontend and workers packages.
      'unicorn/prevent-abbreviations': 'off',
    },
  },

  // ── Project rule tuning ───────────────────────────────────────────────────
  {
    rules: {
      // Honor the `_`-prefix convention for deliberately-unused bindings, mirroring
      // TypeScript's own `noUnusedParameters` (which exempts `_`-prefixed params).
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

  // ── Config-file-only: silence a documented false positive ──────────────────
  // `import tseslint from 'typescript-eslint'` + `tseslint.configs.*` trips
  // import/no-named-as-default-member. Scope off for config files only.
  {
    files: ['**/*.{js,cjs,mjs}'],
    rules: {
      'import/no-named-as-default-member': 'off',
    },
  },

  // ── Prettier must be last ─────────────────────────────────────────────────
  eslintConfigPrettier,
]);
