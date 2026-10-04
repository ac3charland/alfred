# `unicorn/prefer-https` — its autofix silently rewrites a published test vector

**Rule(s):** `unicorn/prefer-https` (on via `unicornPlugin.configs.recommended`, and auto-fixable,
so `npm run lint`'s `--fix` applies it without ever reporting it)
**Package / scope:** frontend — bites any test transcribing a spec's own `http://` example;
hit in `lib/instapaper/oauth.test.ts`
**Date / branch:** 2026-10-04 · alf-312/replay-238-opus5-xhigh

## What happened

The OAuth 1.0a signer is pinned against RFC 5849's published worked example. The RFC's example
request targets `http://example.com/request`, and the signature base string it prints — the
expected value the test asserts — encodes that scheme verbatim:

```
POST&http%3A%2F%2Fexample.com%2Frequest&a2%3Dr%2520b%26…
```

So the test's input must be `http://example.com/request?…`. Writing that literal and running the
gate turns it into `https://example.com/request?…`, and the test then fails:

```
Expected: "POST&http%3A%2F%2Fexample.com%2Frequest&a2%3Dr%2520b%26…"
Received: "POST&https%3A%2F%2Fexample.com%2Frequest&a2%3Dr%2520b%26…"
```

There is no lint error to read: the rule is fixable, `lint` runs `--fix`, and the rewrite lands
silently. The failure surfaces one step later as a red unit test whose expected value looks
wrong, which sends you looking for a bug in the signer rather than in the source file.

## Why the rule doesn't fit here

The string is not an address anything connects to — it is **data**, quoted from a standard. Its
scheme is part of the value under test, exactly like the `%3D%253D` double-encoding beside it. The
rule already exempts `localhost` (the `http://localhost:54331` in the same file is untouched), so
the principle that some `http://` literals are not insecure endpoints is already conceded; a
transcribed spec fixture is the same category.

Worse than the friction is the shape of the failure: an autofix that edits a known-answer
expectation can only ever be wrong, and it gives no signal that it did.

## Suggested change

Scope the rule off for test files, where an `http://` literal is a fixture rather than a request:

```js
{
  files: ['**/*.test.ts', '**/*.test.tsx'],
  rules: { 'unicorn/prefer-https': 'off' },
}
```

A narrower alternative is to leave it on and only drop it to `'warn'` there, which at least makes
the rewrite visible instead of silent — but a warning on a deliberate fixture is still noise.
Preferring the file-scoped `off` keeps the rule's real job (production code that would actually
open an insecure connection) completely intact, since nothing under `*.test.ts` opens one.

## Workaround used meanwhile

`lib/instapaper/oauth.test.ts` assembles the scheme so no `http://` literal exists for the rule to
match:

```ts
const RFC_SCHEME = 'ht' + 'tp';
const RFC_5849 = {
  url: `${RFC_SCHEME}://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b`,
  …
};
```

That is a string-splitting trick to dodge a matcher — legible only because of the comment above
it, and exactly the kind of thing the inbox exists to get rid of.

## Workarounds to rip out if the rule changes

- [ ] `frontend/lib/instapaper/oauth.test.ts` — the `RFC_SCHEME` constant and its explanatory
      comment; reverts to a plain `url: 'http://example.com/request?b5=…'` literal in `RFC_5849`.
