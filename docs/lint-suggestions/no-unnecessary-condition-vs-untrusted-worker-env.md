# `no-unnecessary-condition` — a Worker env var typed `string` cannot be runtime-checked

**Rule(s):** `@typescript-eslint/no-unnecessary-condition` (type-aware; interacts with the
hand-written `Env` interface in `workers/src/index.ts`)
**Package / scope:** workers — anywhere a `[vars]` / secret binding is validated before use
**Date / branch:** 2026-08-09 · claude/llm-classifier-cron-worker-yyanyt

## What happened

The classifier sweep aborts its tick when a required `[vars]` entry did not arrive on the deploy,
rather than calling the API with `model: undefined` and burning an attempt on every eligible item.
`Env` declares both vars as `string`, so the guard reads as provably dead:

```ts
const missing = (['CLASSIFIER_MODEL', 'CLASSIFIER_TIMEZONE'] as const).filter(
  (name) => env[name] === undefined || env[name] === '',
);
```

```
/home/user/alfred/workers/src/sweep.ts
  107:15  error  Unnecessary conditional, the types have no overlap  @typescript-eslint/no-unnecessary-condition
```

## Why the rule doesn't fit here

`Env` is a hand-written declaration of what a deploy is *supposed* to supply, not a fact the
compiler verified. A binding is only as real as the deploy makes it: a `wrangler deploy --var`
that shadows the file's `[vars]` instead of merging with them leaves the field `undefined` at
runtime, and nothing in the type system records that. The rule is reasoning from a declaration
that is exactly what the check exists to distrust.

This is not specific to one guard. Every binding — vars, secrets, future KV/D1 handles — is
declared non-optional and arrives from outside the type system, so any defensive check on one of
them hits this rule. The existing `ANTHROPIC_API_KEY` check escapes only because that field is
already declared optional (`?: string`), which is an inconsistency in `Env` rather than a real
distinction: the key is no less required than the model id.

## Suggested change

Scope the rule down for the Worker's boundary code, e.g. in `workers/eslint.config.js`:

```js
{
  files: ['src/**/*.ts'],
  rules: {
    '@typescript-eslint/no-unnecessary-condition': [
      'error',
      { allowConstantLoopConditions: true, checkTypePredicates: false },
    ],
  },
}
```

That does not actually cover this case, so the honest alternatives are either (a) declare every
`Env` field optional and let the guards narrow — which makes the types tell the truth but pushes
`?? ''` noise into every consumer — or (b) a `files`-scoped override disabling the rule for the
one module that validates bindings. Preference is (a): the type lying is the root cause, and the
rule is right that a check against a `string` is dead code.

## Workaround used meanwhile

A helper whose cast re-widens the field to the type the runtime can actually produce, with a
comment explaining that the cast is the point rather than a bypass — `workers/src/sweep.ts`,
`unsetVars()`:

```ts
const value = env[name] as string | undefined;
return value === undefined || value === '';
```

The function boundary is load-bearing: annotating a local inline (`const value: string | undefined
= env[name]`) still lets TS narrow by assignment, so the rule fires again.

## Workarounds to rip out if the rule changes

- [ ] `workers/src/sweep.ts` — `unsetVars()`'s `as string | undefined` cast and its explanatory
      comment; reverts to a plain inline `.filter()` over `env[name]` once `Env` declares the
      fields optional (or the rule is scoped off this module).
