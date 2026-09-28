---
branch: claude/format-bookmark-test
---

# The frontend formatter no longer rewrites the Instapaper bookmark test

*2026-09-28T20:20:20.896Z*

`frontend/lib/instapaper/bookmark.test.ts` reached `main` in a layout Prettier doesn't produce. Every `check:fast` run (the pre-commit gate) therefore rewrote it, dirtying the working tree of whichever branch was being committed, even branches that never touched it. This branch commits the formatter's own output. The layout on `main` before the fix (pinned to `83fa9a0`):

```bash
git show 83fa9a0:frontend/lib/instapaper/bookmark.test.ts | sed -n 248,255p
```

```output
  it('never repeats Instapaper’s own message, which is not meant for people', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json([{ type: 'error', error_code: 1221, message: 'Internal wording' }], {
          status: 400,
        }),
      );
```

Now run the frontend's own gate steps in `check:fast` order: `eslint --fix`, then Prettier. They leave the file byte-for-byte unchanged, so the two tools agree on the layout and the drift can't come back:

```bash
F=frontend/lib/instapaper/bookmark.test.ts; T=$(mktemp); cp "$F" "$T"; npm run -s lint -w frontend >/dev/null 2>&1; npm run -s format -w frontend >/dev/null 2>&1; if cmp -s "$F" "$T"; then echo "lint --fix, then format: bookmark.test.ts unchanged"; else echo "CHANGED"; fi; rm "$T"; sed -n 248,253p "$F"
```

```output
lint --fix, then format: bookmark.test.ts unchanged
  it('never repeats Instapaper’s own message, which is not meant for people', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json([{ type: 'error', error_code: 1221, message: 'Internal wording' }], {
        status: 400,
      }),
    );
```
