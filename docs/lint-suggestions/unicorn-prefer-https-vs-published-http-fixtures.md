# unicorn/prefer-https — autofix rewrites `http://` fixtures that must stay `http://`

**Rule(s):** `unicorn/prefer-https` (with `eslint --fix`, which `npm run lint` always runs)
**Package / scope:** frontend — `**/*.test.ts` and test doubles (`scripts/mock-supabase.mjs`-style stand-ins)
**Date / branch:** 2026-10-04 · alf-312/replay-238-opus55-xhigh

## What happened
`frontend/lib/instapaper/oauth.test.ts` pins RFC 5849's worked example, whose request is
`POST http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b` and whose published base string
spells the scheme `http%3A%2F%2F`. `npm run lint` silently autofixed the literal to `https://`, so
the computed base string stopped matching the RFC's and the test went red for a reason that had
nothing to do with the signer. The same autofix rewrote an `http://instapaper.test` stand-in URL in
`app/api/reader/posts/[id]/instapaper/route.test.ts` (harmless there, but surprising).

## Why the rule doesn't fit here
The rule exists to stop production code from calling plain-HTTP endpoints. A test fixture that
reproduces a published spec vector — or a loopback mock that only speaks HTTP — is *data about* a
URL, not a request the app will make. Rewriting it changes the meaning of the fixture, and because
the fix is automatic the change is invisible until a test fails.

## Suggested change
Turn the rule off for test files only, in the frontend flat config's existing test-scoped block:

```js
{ files: ['**/*.test.ts', '**/*.test.tsx'], rules: { 'unicorn/prefer-https': 'off' } }
```

## Workaround used meanwhile
The RFC fixture builds its URL from a variable (`` `${SCHEME}://example.com/…` `` with
`const SCHEME = 'http'`) so the autofix can't see a literal, plus a comment saying why.

## Workarounds to rip out if the rule changes
- [ ] `frontend/lib/instapaper/oauth.test.ts` — the `SCHEME` constant and its comment; inline
      `http://example.com/request?…` as the RFC prints it.
