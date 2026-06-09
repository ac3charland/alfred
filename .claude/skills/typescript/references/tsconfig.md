# Alfred tsconfig Reference

## Base pattern (every code-bearing package)

All alfred packages extend `@tsconfig/strictest`. Install once per package:

```bash
npm install --save-dev @tsconfig/strictest
```

### Root `tsconfig.json` (monorepo root — type-checks nothing, just lists projects)

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "files": [],
  "references": [
    { "path": "./frontend" },
    { "path": "./workers" },
    { "path": "./database" }
  ]
}
```

### `database/tsconfig.json` (shared types — referenced by frontend and workers)

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@tsconfig/strictest/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src"]
}
```

### `frontend/tsconfig.json` (Next.js App Router)

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@tsconfig/strictest/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    },
    "composite": true,
    "incremental": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

> Note: Next.js requires `moduleResolution: "Bundler"` for App Router. Do NOT use `NodeNext` in the
> frontend — it breaks path resolution for Next.js.

### `workers/tsconfig.json` (Cloudflare Workers)

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@tsconfig/strictest/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src"]
}
```

## What `@tsconfig/strictest` gives you

All of `strict: true` (8 flags) plus:

| Flag | What it catches |
|---|---|
| `exactOptionalPropertyTypes` | Assigning `undefined` to `field?: T` (use `field: T \| undefined` instead) |
| `noUncheckedIndexedAccess` | `arr[i]` and `obj[key]` return `T \| undefined`, not `T` |
| `noFallthroughCasesInSwitch` | Missing `break` / `return` in switch cases |
| `noImplicitOverride` | Subclass methods that override base class without `override` keyword |
| `noImplicitReturns` | Function branches that don't return a value |
| `noPropertyAccessFromIndexSignature` | `obj.dynamicKey` on index-signature types (must use `obj["key"]`) |
| `noUnusedLocals` | Declared but never-read variables |
| `noUnusedParameters` | Function parameters that are never read (prefix with `_` to suppress) |
| `allowUnreachableCode: false` | Code after `return`/`throw` that can never run |
| `allowUnusedLabels: false` | Labeled statements that are never `break`-ed to |
| `isolatedModules: true` | Type-only re-exports must use `export type`; required by esbuild/SWC |

## type-check command

```bash
# Per-package (run from package root)
tsc --no-emit

# Monorepo-wide with project references
tsc --build --no-emit
```

`check:fast` in each package runs `tsc --no-emit`. The root `check:fast` fans out to each package.

## Common tsconfig mistakes

- **Do not set `skipLibCheck: true` to silence `.d.ts` errors in library types.** The
  `@tsconfig/strictest` base already sets it correctly. If a library's types are wrong, use a
  type-override approach or file an issue.
- **Do not set `strict: false` or any individual strict flag to `false` to pass type-check.** Per
  alfred CLAUDE.md hard rules: fix the code.
- **Do not mix `module: CommonJS` into a Next.js package.** Use `Bundler` + `ESNext` for the
  frontend; the Next.js compiler handles the rest.

> Sources: @tsconfig/bases repository (github.com/tsconfig/bases, v2.0.0, confirmed);
> TypeScript TSConfig Reference (typescriptlang.org/tsconfig)
