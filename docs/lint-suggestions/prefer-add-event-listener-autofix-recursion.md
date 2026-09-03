# `unicorn/prefer-add-event-listener` — the autofix writes infinite recursion into a socket stub

**Rule(s):** `unicorn/prefer-add-event-listener` (+ `unicorn/prefer-switch`, which reshapes the
code first and hands the autofix a bigger target)
**Package / scope:** frontend — `e2e/**` (anywhere a DOM-ish object is *implemented*, not consumed)
**Date / branch:** 2026-09-03 · claude/live-update-inbox-llm-classify-zdwdsu

## What happened
`e2e/support/realtime.ts` implements a fake `WebSocket` so a test can push a
`postgres_changes` frame. A fake socket has to own the four handler slots, and route a listener
registered either way (`socket.onmessage = fn` or `addEventListener('message', fn)`) to the same
slot:

```ts
private slotFor(type: string, listener: SocketHandler) {
  if (type === 'open') this.onopen = listener;
  else if (type === 'message') this.onmessage = listener;
  …
}
```

Each assignment errors:

```
error  Prefer `addEventListener` over `onmessage`. Note that there is difference between
`SharedWorker#onmessage` and `SharedWorker#addEventListener('message')`
unicorn/prefer-add-event-listener
```

and `--fix` **rewrote two of the four branches in place** to
`this.addEventListener('open', listener)` — inside the method that `addEventListener` itself
delegates to. That is unbounded recursion, written silently into the source by the gate, and it
still left the other two branches erroring, so the failure looked like an ordinary unfixed lint
error rather than a bug that had just been introduced.

## Why the rule doesn't fit here
The rule assumes the object is a DOM node you are *using*. Here it is one we are *defining* — the
handler properties are the API surface being implemented, and `addEventListener` is implemented
in terms of them, so the rewrite the rule prescribes is circular by construction.

## Suggested change
Disable `unicorn/prefer-add-event-listener` for `e2e/**` and `tests/**` in
`frontend/eslint.config.mjs`, beside the other Playwright-scoped overrides — a test double for a
browser API is the only place in this repo that implements these properties rather than assigning
them on a real node. Failing that, turning the rule's autofix off repo-wide would at least keep it
from writing a bug.

## Workaround used meanwhile
`slotFor` assigns through a computed key (`this[SLOTS[type]] = listener`) with a `SLOTS` lookup
table, which the rule can't pattern-match. It reads fine, but it exists to dodge an autofix rather
than because a table beats four named assignments.

## Workarounds to rip out if the rule changes

- [ ] `frontend/e2e/support/realtime.ts` — the `SLOTS` table and its comment; `slotFor` reverts to
      four plain `this.onopen = listener` assignments.
