# ALF-46 — Make real-time code toasts way more obvious

## Context / problem

The code module pushes a transient toast whenever a story changes `factory_state`
out of band — a Claude session lands a PR, the webhook Worker moves a card, another
device writes the row (ALF-41). That toast is the user's only in-page signal that the
thing they launched and are waiting for actually happened. Today it's far too quiet:

- It's the **same minimal toast** the gate uses for "Created ALF-42" — `max-w-xs`,
  `px-4 py-3`, `text-sm`, a faint border, a drop shadow. Easy to miss on a dense dark UI.
- It **has no entrance/exit motion worth the name**. The viewport applies
  `animate-fade-in` on mount, but on dismissal (close button **or** auto-expire) the
  toast is filtered straight out of the store and **unmounts instantly** — it pops out
  with no fade, no slide. So toasts effectively "pop" in and out instead of gliding.
- There's **no audio cue at all**, so a move that lands while the user is reading
  another part of the page goes unnoticed until they happen to look at the corner.

The relevant code:

- `frontend/lib/stores/toast-store.tsx` — the `ToastProvider` queue. `showToast(message)`
  pushes `{ id, message }` and schedules a `setTimeout` removal after `DISMISS_MS` (4000);
  `dismissToast(id)` filters the toast out immediately. Deliberately variant-free.
- `frontend/components/shell/toast-viewport.tsx` — renders the queue into a fixed
  bottom-right `aria-live="polite"` region; each toast is a `bg-surface` card with a
  close button and `animate-fade-in motion-reduce:animate-none`.
- `frontend/lib/stores/code-store.tsx` (~L382) — the realtime UPDATE handler fires
  `showToast(\`${row.ref} moved to ${label}\`)` for a real external `factory_state` change.
- `frontend/components/tasks/task-row.tsx` (~L700) — the gate fires
  `showToast(\`Created ${story.ref ?? ''}\`)`.

We want the realtime code-move toast to be **loud and unmissable**, while every toast
gets a proper glide in **and** out.

## Proposed change

Two independent improvements, split by who they apply to (confirmed in refinement):

1. **A new `emphasis` toast variant** — glowing border, bigger size, and a sound — used
   **only** by the realtime code-move toast. The gate's "Created" toast stays plain.
2. **A real enter *and* exit animation (slide + fade) for *all* toasts**, replacing the
   current "fade in, pop out" behavior.

### 1. Add a toast variant to the store

Extend the store's public type and action; keep the default behavior identical so the
gate caller needs no change.

- `Toast` gains `variant: 'default' | 'emphasis'`.
- `showToast(message: string, variant: 'default' | 'emphasis' = 'default')` — the second
  arg is optional and defaults to `'default'`, so existing callers (`task-row.tsx`) are
  untouched.
- The realtime handler in `code-store.tsx` passes `'emphasis'`:
  `showToast(\`${row.ref} moved to ${label}\`, 'emphasis')`.

This is the first variant the store has carried; the store doc comment ("No variants…")
should be updated to reflect that an `emphasis` variant now exists.

### 2. Play a sound for `emphasis` toasts (reduced-motion-aware)

When an `emphasis` toast is enqueued, play a short, soft chime. Confirmed behavior:
**play, but respect `prefers-reduced-motion`** — silent when the user has reduced motion
set. No mute UI / persisted preference in this ticket.

- Add a small, mockable helper `frontend/lib/play-toast-sound.ts` that produces a short
  chime via the **Web Audio API** (a brief oscillator + gain envelope — no committed
  binary audio asset, nothing to bundle, trivially mockable in tests). It must be a no-op
  when `AudioContext` is unavailable (older browsers / SSR-safety) and never throw.
- Fire the sound from the **store's `showToast` action** when `variant === 'emphasis'`,
  guarded by a direct `matchMedia('(prefers-reduced-motion: reduce)').matches` check
  (firing from the single imperative action call means exactly one sound per toast — no
  duplicate from React StrictMode double-invoking a mount effect). Per the motion skill,
  `matchMedia` is always-defined in client code and the action only runs client-side, so
  call it directly (no `?.`).
- **Autoplay caveat:** browsers gate Web Audio behind a prior user gesture. The user
  launched the session and is typically interacting with the board, so the first realtime
  toast usually plays; if the page has had zero interaction the chime may be silently
  suppressed by the browser. That's an accepted limitation (see Out of scope), not a bug
  to fight here.

### 3. Make the `emphasis` toast louder (glow + bigger size)

In `toast-viewport.tsx`, branch the per-toast classes on `toast.variant`:

- **Glowing border.** Reuse the established glow pattern in `globals.css` (the
  `@utility glow-teal/green/blue/amber` block, `box-shadow: 0 0 16px 2px rgba(…, 0.15)`).
  Add a brighter emphasis treatment — recommended: an accent-teal border
  (`border-accent-teal`, the code/brand accent `#4fd1e0`) plus a stronger glow than the
  existing 0.15-alpha utilities. Add a dedicated `@utility glow-emphasis` (teal, higher
  alpha / larger spread) rather than overloading `glow-teal`, so the ambient-glow uses
  elsewhere are unaffected. A static glow is enough — no pulsing keyframe (motion stays
  restrained per SPEC §5.4); a gentle pulse is listed as an open question.
- **Bigger size.** Bump the emphasis card from the default `max-w-xs px-4 py-3 text-sm`
  to roughly `max-w-sm px-5 py-4 text-base` so it reads as a distinct, weightier card.
  Default toasts keep their current sizing.

Compose these with `cn()` exactly as the viewport already does; the default branch must
render byte-for-byte the same classes it does today (so default toasts don't regress).

### 4. Fix enter **and** exit motion for all toasts (slide + fade both ways)

Today the queue filters a dismissed toast out instantly, so there's nothing left to
animate on the way out. Give the store a **two-phase dismissal** so the exit can play,
and have the viewport render the matching enter/exit classes:

- **Store: model a leaving phase.** `Toast` gains a `leaving: boolean` (or an equivalent
  `phase: 'visible' | 'leaving'`). `dismissToast(id)` no longer removes immediately — it
  marks the toast `leaving`, then schedules final removal after a new `EXIT_MS` constant
  (matched to the exit animation duration, ~200ms). The `DISMISS_MS` auto-expire timer
  calls the same `dismissToast` path so auto-expiry also animates out. Removing a toast
  that's already `leaving` is idempotent. (This is the store-driven analogue of the
  motion skill's animate-then-commit pattern: play the exit, then commit the removal.)
- **Viewport: render enter vs exit.** A `visible` toast uses the entrance classes; a
  `leaving` toast uses the exit classes. Use `tw-animate-css` (already imported) for the
  compound fade+slide, as the motion skill prescribes for "fade + slide a panel":
  - enter: `animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none`
  - exit: `animate-out fade-out-0 slide-out-to-bottom-2 duration-200 motion-reduce:animate-none`
  (bottom-right viewport → slide up in / down out reads naturally; the exact offset/edge
  is an implementation detail — bottom or right both fine.)
- **Reduced motion.** Both class sets keep `motion-reduce:animate-none`, so reduced-motion
  users get no slide/fade. Because removal is **timer-driven** (`EXIT_MS`), not
  `animationend`-driven, reduced motion just means the toast holds for `EXIT_MS` then
  disappears with no animation — no flash, no stranded toast (this deliberately sidesteps
  the "`motion-reduce:animate-none` breaks `animationend` unmounts" pitfall in the motion
  skill).
- Consider extracting a small `ToastItem` child component so each toast owns its
  variant/phase class logic cleanly (per the frontend-architecture skill); optional.

### 5. Tests

Follow TDD; every behavior below must be pinned by a test (jest/RTL unit + a Storybook
snapshot for the visuals):

- **`toast-store.test.tsx`** (new):
  - `showToast(msg)` defaults `variant` to `'default'`; `showToast(msg, 'emphasis')`
    stores `'emphasis'`.
  - An `emphasis` toast calls the (mocked) `play-toast-sound` helper **once**; a
    `'default'` toast does **not**; with `matchMedia` mocked to `matches: true`
    (reduced motion) an `emphasis` toast does **not** play.
  - Two-phase dismissal (fake timers): `dismissToast` marks the toast `leaving` (still in
    the queue) and only removes it after `EXIT_MS`; the `DISMISS_MS` auto-expire goes
    through the same `leaving → remove` path.
- **`toast-viewport.test.tsx`** (RTL): an `emphasis` toast renders the glow + bigger-size
  classes and a `'default'` toast does not; a `leaving` toast renders the `animate-out`
  exit classes while a `visible` one renders the `animate-in` enter classes.
- **`code-store.test.tsx`** (update): the existing realtime-move assertions change to
  `expect(mockShowToast).toHaveBeenCalledWith('ALF-42 moved to Ready for Dev', 'emphasis')`
  (and the Blocked case likewise). Non-state updates / echoes still fire nothing.
- **Storybook story** (new, e.g. `toast-viewport.stories.tsx`): default vs emphasis
  toasts, so the snapshot gate locks the glow/size visuals. Mock the sound helper so the
  story doesn't try to play audio.

### 6. Demo doc

Per the workflow, capture `docs/demos/ALF-46/…` with `npm run demo`:

- A `npm run screenshot` of the bigger, glowing emphasis toast next to a default toast.
- Use the **debug-animations** skill to sample opacity/transform frame-by-frame on enter
  **and** exit, proving the toast actually slides/fades both ways (the core "it just pops
  in and out currently" complaint). Audio can't be screenshotted — note the sound
  behavior and its reduced-motion guard in prose, evidenced by the unit test.

### 7. Record learnings

If anything non-obvious surfaces (e.g. the autoplay-gesture gating, or the timer-driven
exit choice over `animationend`), record it per the compounding-learning rule — most
likely in the **motion** skill (toast enter/exit pattern, sound-as-motion guard) and/or a
note in the **data-flow** skill (two-phase store dismissal).

## Acceptance criteria

- [ ] `showToast` accepts an optional `variant: 'default' | 'emphasis'` (default
      `'default'`); `Toast` carries the variant. Existing default callers are unchanged.
- [ ] The realtime `factory_state`-change toast in `code-store.tsx` is fired with
      `'emphasis'`; the gate's "Created …" toast stays `'default'`.
- [ ] An `emphasis` toast plays a short Web Audio chime exactly once on enqueue, and is
      **silent** when `prefers-reduced-motion: reduce` is set. The helper no-ops (never
      throws) when `AudioContext` is unavailable. `'default'` toasts never play a sound.
- [ ] An `emphasis` toast renders visibly louder than a default toast: a glowing
      accent-teal border (a `glow-emphasis` utility distinct from the existing
      0.15-alpha `glow-*` utilities) and a larger card (≈`max-w-sm px-5 py-4 text-base`).
      Default toasts render the same classes they do today.
- [ ] **Every** toast slides + fades **in** on appear and slides + fades **out** on
      dismissal — both the close button and auto-expiry animate out rather than popping.
      Implemented via a store `leaving` phase + `EXIT_MS` delayed removal and
      `tw-animate-css` `animate-in`/`animate-out` classes.
- [ ] All entrance/exit motion carries `motion-reduce:animate-none`; under reduced motion
      toasts appear/disappear without animation and without flash or being stranded.
- [ ] Tests cover: the variant default + override; emphasis-plays / default-silent /
      reduced-motion-silent sound; the two-phase `leaving → remove` dismissal under fake
      timers; the emphasis glow/size classes vs default in the viewport; and the updated
      `code-store` realtime assertion. A Storybook snapshot locks default vs emphasis.
- [ ] `check` is green and the change is captured in a `docs/demos/ALF-46/…` demo doc
      (screenshot of the emphasis toast + a debug-animations capture of the enter/exit
      glide).

## Out of scope / open questions

- **Mute toggle / persisted sound preference.** Confirmed out — sound just respects
  `prefers-reduced-motion`. A user-facing mute control is a separate ticket if wanted.
- **Browser autoplay gating.** If the page has had zero user interaction, the browser may
  suppress the first chime. Accepted limitation; not worked around here.
- **Loud treatment on non-code toasts.** Only realtime code-move toasts use `emphasis`;
  the gate "Created" toast stays plain. Other future toasts choose their own variant.
- **A pulsing/animated glow** on the emphasis toast — deliberately left static to keep
  motion restrained (SPEC §5.4). Open question if a gentle pulse is later desired.
- **Exact slide edge/offset and chime timbre** are implementation details within the
  recommendations above; the demo doc + snapshot are the final arbiter of feel.
- **A general toast severity scale** (success/error/warning) — not needed now; `emphasis`
  is the single new variant this ticket introduces.
