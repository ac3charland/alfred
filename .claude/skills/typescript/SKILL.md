---
name: typescript
description: >
  Covers TypeScript in the alfred monorepo: strict tsconfig setup, type-aware patterns
  that satisfy @typescript-eslint strict-type-checked, discriminated unions,
  unknown/narrowing, no-floating-promises, the satisfies operator, utility types, and
  nullable DB-column modeling. Use whenever writing or reviewing TypeScript — required
  reading before touching any tsconfig, ESLint config, or writing new types/interfaces.
---

# TypeScript Skill — alfred monorepo

## Mental Model

TypeScript's type system is a **proof layer that runs at build time, not a runtime safety net**.
Every type annotation is a claim you make to the compiler. `strict: true` tightens those claims;
the extra strictness flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.) close
loopholes that `strict` leaves open. The @typescript-eslint type-checked rules then enforce a second
layer: correct *usage* of async code, avoidance of `any` escape hatches, and exhaustive handling.

The key mental shift for strict TypeScript:
- **`undefined` and `null` are different things.** `string | null` means the value is present but
  explicitly absent; `string | undefined` means the property may not exist at all. With
  `exactOptionalPropertyTypes`, these are not interchangeable.
- **Index access is a lie without `noUncheckedIndexedAccess`.** `arr[0]` returns `T`, not
  `T | undefined`, unless the flag is on — even when `arr` might be empty.
- **`any` is a hole in the proof.** Every use of `any` silently disables every downstream check.
  `unknown` preserves safety and forces a narrowing step before use.
- **Async code is fire-and-forget unless you `await` or chain `.catch()`.** The
  `no-floating-promises` rule turns unhandled Promises from a runtime mystery into a compile-time
  error.

> Source: TypeScript Handbook, typescriptlang.org; @tsconfig/bases maintainers
> (github.com/tsconfig/bases, v2.0.0 — `strictest.json` confirmed)

---

## Decision Tree

### type vs interface

```
Does the shape need to participate in declaration merging (e.g., augmenting a library)?
  → Yes → interface

Is it a union, intersection, tuple, primitive alias, or mapped/conditional type?
  → Yes → type

Is it an object shape that a class will implement?
  → Yes → interface (the extends story is more ergonomic)

Otherwise?
  → Either works. Pick one and be consistent per file.
  → alfred convention: type for data shapes (DB rows, API payloads);
    interface for component prop types and class contracts.
```

> Rationale: interfaces are cached internally by the compiler; type intersections (`&`) are
> recomputed each time. Prefer `interface extends` over `type &` for performance at scale.
> Source: LogRocket Blog, "Types vs. interfaces in TypeScript"

### enum vs string-literal union

```
Do you need runtime iteration over all values (e.g., to populate a dropdown)?
  → Yes → const array + as const + typeof (see pattern table row)
  → Never use TypeScript numeric or string enums — they compile to runtime objects,
    add bundle weight, and interact poorly with isolatedModules.

Do you just need a type-level constraint?
  → String-literal union: type ItemType = 'unclassified' | 'task' | 'code' | 'knowledge'
```

> Source: Stefan Baumgartner ("fettblog.eu"), "Tidy TypeScript: Prefer union types over enums"

### generics vs overloads

```
Does the return type depend on a *specific input value* (not just its type)?
  → Use overloads — they capture "when arg is X, return is Y" relationships.

Does the return type *mirror the input type* (identity-like transformation)?
  → Use a generic — it preserves the specific type through the function.

Do you need both: variant return shapes AND type preservation?
  → Combine: overload signatures on top, generic implementation body below.
```

---

## Plain-English → Pattern Table

| When the user says... | Use this pattern | Key things to know |
|---|---|---|
| "strict tsconfig for a monorepo package" | Extend `@tsconfig/strictest` + add `composite: true` for project references | `@tsconfig/strictest` sets: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals/Parameters`, `allowUnreachableCode: false`, `isolatedModules: true`. See `references/tsconfig.md` for the full alfred base. |
| "model this item_type enum / status enum" | String-literal union + `as const` array for runtime access | `type ItemType = 'unclassified' \| 'task' \| 'code' \| 'knowledge'`; for runtime values: `const ITEM_TYPES = ['unclassified', 'task', 'code', 'knowledge'] as const; type ItemType = typeof ITEM_TYPES[number]` |
| "switch on item_type / status and make it exhaustive" | Discriminated union + `assertNever` helper | Add a `default: assertNever(x)` branch; `function assertNever(x: never): never { throw new Error('Unhandled case: ' + String(x)) }`. If you add a new union member and forget a case, TS errors at the `assertNever` call site. Requires `noFallthroughCasesInSwitch`. |
| "narrow this unknown value (e.g., from JSON.parse or catch block)" | `typeof` / `instanceof` / `in` guards + user-defined type predicates | Never cast `unknown as MyType` — narrow it: `if (typeof val === 'string')`, `if (val instanceof Error)`, `if (typeof val === 'object' && val !== null && 'id' in val)`. For reuse, write `function isMyType(v: unknown): v is MyType { ... }`. TS 5.5 infers predicates from simple boolean-returning functions automatically. |
| "type this async function so no-floating-promises is happy" | Always `await` or `.catch()` at every call site; use `void` only for intentional fire-and-forget | The three valid patterns: `await doThing()`, `doThing().catch(handleError)`, or `void doThing()` (only when truly fire-and-forget — `void` suppresses the lint error but rejection is still unhandled at runtime). Event-handler fire-and-forget: `void (async () => { await doThing() })()` |
| "avoid no-misused-promises — passing async fn to non-async callback" | Wrap the async body so the outer callback is synchronous | `onClick={() => { void handleClick() }}` — the outer arrow returns `void`, not `Promise`. Never pass an `async` function directly to `onClick`, `forEach`, `Array.sort`, etc. |
| "make this object's keys exhaustive over a union" | `Record<UnionType, V>` with no optional keys | `const handlers: Record<ItemType, () => void> = { unclassified: ..., task: ..., code: ..., knowledge: ... }` — TypeScript errors if any key is missing or misspelled. Combine with `satisfies` to keep literal types while validating shape. |
| "validate shape without widening the inferred type" | `satisfies` operator (TS 4.9+) | `const config = { ... } satisfies Config` — the variable keeps its narrow (literal) type; `satisfies` only validates the shape. For immutable literals: `const config = { ... } as const satisfies Config` (order matters: `as const` before `satisfies`). |
| "model a nullable DB column" | `field: T \| null` (not `field?: T`) | `null` = present but absent; `undefined` = property doesn't exist. DB columns are always present — they're just `null` when empty. With `exactOptionalPropertyTypes`, you cannot assign `undefined` to a `field?: T` property that doesn't explicitly include `undefined` in its type. Use `field: string \| null` for nullable; `field?: string` only for truly optional JS properties. |
| "update a subset of fields (PATCH endpoint)" | `Partial<T>` for the patch payload; `Required<Pick<T, 'id'>>` to ensure ID is always present | Avoid `Partial` on the DB row type itself — it makes all fields optional including required ones. Create a separate `UpdatePayload` type: `type UpdateItemPayload = Partial<Omit<Item, 'id' \| 'created_at'>> & { id: string }` |
| "type a function that transforms data generically" | Generic with constraint: `function fn<T extends Base>(arg: T): Transformed<T>` | Always constrain generics (`extends`) unless truly unconstrained. Use `const fn = <T extends Base>(arg: T) => ...` in arrow functions to avoid JSX ambiguity in `.tsx` files. |
| "read from an array index safely with noUncheckedIndexedAccess on" | Explicit undefined check before use | `const first = arr[0]` has type `T \| undefined`. Use `if (first !== undefined)` or `arr.at(0)` + null check. For-of loops and `Array.prototype.filter/map` are unaffected — the `T | undefined` only applies to index expressions. |
| "share types between frontend and workers packages" | `database/` types package with `composite: true`; import via workspace path | Define DB row types once in `database/`; both `frontend/` and `workers/` reference it. Use `/// <reference types="..." />` or `import type` to keep the dependency type-only and avoid bundle bloat. |
| "type a React Server Component async function" | `export default async function Page(): Promise<JSX.Element>` — and `await` all data fetches inside | RSC functions are `async` — their return is implicitly `Promise<JSX.Element>`. The `no-floating-promises` rule applies to any `await`-able call inside them; always `await` Supabase queries. |

---

## Common Pitfalls

**Always set these flags beyond `strict: true` in every alfred package:**
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`,
`noImplicitOverride`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`,
`allowUnreachableCode: false`, `isolatedModules: true`. These are all in `@tsconfig/strictest`.

**Never use `any`.** It propagates silently — a function returning `any` makes every downstream
expression `any`, disabling all no-unsafe-* lint rules. Use `unknown` + narrowing, generics with
constraints, or `Record<string, unknown>` for genuinely unknown shapes.

**Never use `@ts-ignore` or `@ts-expect-error` to pass type-check.** Per the alfred CLAUDE.md hard
rules, these are forbidden. Fix the type error in the code.

**Never use `// eslint-disable` to suppress a no-unsafe-* or no-floating-promises error.** Same rule.

**`noUncheckedIndexedAccess` makes `arr[0]` return `T | undefined`, not `T`.**
This includes `Record<string, T>` and any object with an index signature. It does NOT affect
for-of loops, destructuring, or `.map()`/`.filter()` callbacks — those stay `T`.

**Don't write `arr[0] as T` under strict lint — two autofixes fight and leave you stuck.**
With `noUncheckedIndexedAccess`, `arr[0]` is `T | undefined`, so `arr[0] as T`
trips `@typescript-eslint/non-nullable-type-assertion-style`, whose autofix rewrites it
to `arr[0]!` — which then trips `@typescript-eslint/no-non-null-assertion` (forbidden,
no autofix). The escape is to **restructure, not assert**: assert on the whole value
(`expect(arr).toEqual([...])` instead of `expect(arr[0] as T)`), destructure
(`const [first] = arr` then guard `first`), or narrow with an explicit
`if (first === undefined) …`. Common when indexing a parsed array in a test.

**`exactOptionalPropertyTypes` makes `undefined` and "missing" different.**
You cannot pass `{ field: undefined }` where `{ field?: string }` is expected — `undefined` is not
the same as "not present". When building partial update objects via spread: use
`{ ...(val !== undefined && { field: val }) }` to conditionally include a key.

**DB nullable columns are `T | null`, not `T | undefined` and not `T?`.**
Supabase returns `null` for empty columns, never `undefined`. Model every nullable column as
`field: string | null` (present but null), not `field?: string` (may not exist).

**`void` on a floating promise only silences the linter — it does NOT handle the rejection.**
Use `.catch()` for any promise where you care about failure. `void expr` is correct only for
truly fire-and-forget side effects where you are deliberately ignoring errors.

**String-literal unions, not TypeScript enums.**
Enums compile to runtime objects and break `isolatedModules` in some edge cases. Use
`type ItemType = 'task' | 'code' | ...` for type-level constraints, and `as const` arrays when
you need runtime iteration.

**`as const satisfies T` — order matters.**
`as const satisfies T` works. `satisfies T as const` is a compile error. Always `as const` first.

**In `.tsx` files, `<T>` type parameters are parsed as JSX.**
Write `<T,>` or `<T extends unknown>` to disambiguate. Prefer the comma form.

**`noImplicitOverride` requires the `override` keyword on subclass methods.**
If you forget `override`, the compiler errors. This is always a useful signal — if the base method
is renamed, your "override" silently becomes a new method without the keyword.

---

## Version Gotchas (TypeScript 5.x)

- **TS 5.0+: `extends` accepts an array** — `"extends": ["@tsconfig/strictest/tsconfig", "@tsconfig/node20/tsconfig"]`
  in a single tsconfig.json. Agents trained on pre-5.0 content will write multiple tsconfig files
  to achieve the same thing.

- **TS 5.0+: `const` type parameter modifier** — `function fn<const T extends string[]>(arr: T)` infers
  `T` as a tuple of literals, removing the need for callers to add `as const`. Use this on functions
  that take configuration arrays/objects where you want literal-type inference.

- **TS 5.5+: Type predicates are now inferred** — `const isString = (x: unknown) => typeof x === 'string'`
  automatically gets the type `(x: unknown) => x is string`. You no longer need explicit `: x is Type`
  annotations for simple, single-return-statement guards. The `arr.filter(isNonNull)` pattern now
  correctly narrows the resulting array type.

- **TS 5.9+: `tsc --init` now emits `noUncheckedIndexedAccess: true` and `exactOptionalPropertyTypes: true`**
  by default in generated tsconfigs. Agents may assume these are off if trained on older content.

- **TS 6.0+: `strict: true` is the default** — omitting `strict` from a new tsconfig no longer means
  "permissive". Existing projects that relied on `strict` being `false` by default must now set it
  explicitly. For alfred this is moot (we always set it explicitly), but worth knowing when reading
  older upgrade guides.

> Sources: Microsoft TypeScript DevBlog announcements for TS 5.0, 5.5, 5.9, 6.0
> (devblogs.microsoft.com/typescript)

---

## What Was Deliberately Left Out

- **`declare module` / ambient declarations** — not needed in this codebase; all types are explicit
  and imported.
- **`namespace`** — legacy pattern; all module systems in alfred use ES modules.
- **TypeScript numeric enums** — excluded intentionally because the alfred codebase uses string-literal
  unions instead. Don't reach for them.
- **`@ts-expect-error`** — forbidden in alfred (CLAUDE.md hard rule); documenting how to use it
  would undermine the guardrail.
- **Declaration files (`.d.ts`) authoring** — alfred does not publish a library; all types live in
  `.ts` source files.
- **Complex conditional/mapped types beyond common utility types** — the project does not need
  deep type-level programming; when a complex mapped type seems needed, reconsider the data model
  first. Patterns like `infer`, `DeepPartial`, `DeepReadonly` are left out to avoid over-engineering.
- **JSDoc type annotations** — alfred uses TypeScript source files throughout; JSDoc types are for
  JavaScript files and are not relevant here.
- **`experimentalDecorators` / legacy decorators** — the project does not use class-based
  decorators. TS 5.0 ECMAScript decorators exist but are not part of the current stack.
