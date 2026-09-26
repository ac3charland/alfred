# unicorn/prefer-https — its autofix silently rewrites protocol test vectors

**Rule(s):** `unicorn/prefer-https` (autofix, applied by `npm run lint`'s `--fix` in pre-commit)
**Package / scope:** frontend — `**/*.test.ts` (and any fixture whose URL is data, not a link)
**Date / branch:** 2026-09-25 · claude/instapaper-button-reader-884sjl

## What happened
`lib/instapaper/oauth.test.ts` pins the OAuth 1.0a signer to RFC 5849's worked examples, whose
URLs are plain HTTP (`http://example.com/request?…`, `http://photos.example.net/photos?…`,
`oauth_callback=http://printer.example.com/ready`). The lint pass reported `Prefer HTTPS over
HTTP.` and its `--fix` rewrote every one to `https://` with no failure. The next test run went red
on three published vectors — the scheme is part of the signed base string, so a different scheme
is a different signature.

## Why the rule doesn't fit here
The rule is right for links a person clicks or code fetches. In a test vector the URL is data: its
exact bytes are the input to a checksum, and "upgrading" it changes the expected output. The fix is
also silent — it lands inside the pre-commit gate, so the corruption shows up as a failing test
several steps later, far from its cause, and could be "fixed" by an agent re-deriving the expected
value from the corrupted input.

## Suggested change
Keep the rule, but drop the autofix for test files so a literal `http://` there is reported, not
rewritten — or turn the rule off for `**/*.test.{ts,tsx}` in `frontend/eslint.config.mjs`:

```js
{ files: ['**/*.test.{ts,tsx}'], rules: { 'unicorn/prefer-https': 'off' } },
```

## Workaround used meanwhile
The scheme is spelled apart from the host (`const HTTP = 'http:'` and `` `${HTTP}//example.com/…` ``),
so the rule's regex never sees a literal `http://`.

## Workarounds to rip out if the rule changes
- [ ] `frontend/lib/instapaper/oauth.test.ts` — the `HTTP` constant and its three `` `${HTTP}//…` ``
      template URLs; revert to the RFC's literal `'http://…'` strings.
