# unicorn/prefer-https — autofix rewrites a published `http:` test vector

**Rule(s):** `unicorn/prefer-https` (with `eslint --fix` in the `lint` script)
**Package / scope:** frontend — `**/*.test.ts`
**Date / branch:** 2026-10-04 · alf-312/replay-238-opus55-medium

## What happened
`lib/instapaper/oauth.test.ts` pins the OAuth signer to RFC 5849's worked example, whose request
URL is `http://example.com/request?…`. The scheme is part of the signed base string. `npm run lint`
silently autofixed the literal to `https://`, and the vector test went red
(`Expected: "POST&http%3A…" Received: "POST&https%3A…"`).

## Why the rule doesn't fit here
In a test fixture an `http:` URL is often *data* copied from a spec, not a link anyone follows.
Rewriting it changes what the test asserts, and because the fix is automatic it lands without the
author noticing until the test fails.

## Suggested change
Turn the rule off (or make it non-fixable) for test files:

```js
{ files: ['**/*.test.ts', '**/*.test.tsx'], rules: { 'unicorn/prefer-https': 'off' } }
```

## Workaround used meanwhile
The literal is assembled from parts: `['http', '//example.com/request?…'].join(':')`, with a
comment saying why.

## Workarounds to rip out if the rule changes
- [ ] `frontend/lib/instapaper/oauth.test.ts` — `RFC_URL` back to a plain string literal.
