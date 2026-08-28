---
branch: claude/alf-182-slide-out-animation-4fjhxs
---

# Dispatch sends every item off together

*2026-08-28T15:16:33.533Z*

Pressing **Dispatch** used to remove every selected row in the same commit: the store mutation filtered them out of the Inbox, so they vanished on the spot — and a code item didn't even go with them, since it only left once the factory RPC answered.

Now the whole selection leaves **together**, on the same slide-out the capture box gives a just-captured thought, and the rows that stay glide up into the gap.

## One animation, two surfaces

The slide is a single motion token, so `captureGhostClass` (a thought leaving the capture box) and `sendOffClass` (a row leaving the Inbox) can never drift apart:

```bash
sed -n '/The "sent off" flourish/,/--animate-send-off/p' frontend/app/globals.css
```

```output
  /* The "sent off" flourish — a fade + slide to the right that says a thing has
     LEFT for somewhere else. Shared by the capture ghost (the just-typed thought
     leaving the capture box) and an Inbox row being dispatched, so the two are
     literally the same motion rather than two copies of one recipe. `forwards`
     holds it at opacity 0 / fully slid through the gap between the animation
     ending and the element unmounting — same flash reason as `fade-out`. */
  --animate-send-off: send-off 300ms ease-out forwards;
```

Both surfaces reference that one token by name:

```bash
grep -rn 'animate-send-off' frontend/components/tasks/capture-box.styles.ts frontend/components/tasks/task-row.styles.ts
```

```output
frontend/components/tasks/capture-box.styles.ts:19: * is the shared `--animate-send-off` token — the same motion a dispatched Inbox row leaves on
frontend/components/tasks/capture-box.styles.ts:29:  'animate-send-off motion-reduce:animate-none',
frontend/components/tasks/task-row.styles.ts:35:export const sendOffClass = 'animate-send-off motion-reduce:animate-none';
```

## Three rows, one send-off

Three of the four Inbox rows are selected and dispatched. All three slide right and fade at the same moment, and "Book the dentist" — the one left behind — glides up into the gap they leave.

![three selected rows slide out together while the remaining row glides up](dispatch-send-off-video-1.gif)

## A code item goes with them, not when the server answers

A code item used to sit in the Inbox until the factory gate call came back, so a mixed selection left in two waves. Here the gate call is held for three seconds — and the code row still leaves on the same beat as the task beside it. Select mode only ends (and the toast only lands) once the server actually answers; a failure would put the row straight back.

![a task and a code item leave together while the gate call is still in flight](dispatch-send-off-video-2.gif)

## The row's own ⋯ menu sends one off the same way

Dispatching a single row from its ⋯ menu (ALF-185) leaves on the very same send-off, so triaging one item and triaging a batch look alike.

![a row dispatched from its own menu slides out while the row below moves up](dispatch-send-off-video-3.gif)

## Reduced motion

With `prefers-reduced-motion`, nothing is flagged and nothing is waited on — the rows simply go the moment Dispatch is pressed, exactly as before. That branch is pinned by a unit test rather than a GIF, since there is no motion to record.
