---
name: motion
description: >
  Documents the frontend's motion conventions — animation tokens, fade/slide reveals,
  expand/collapse, and prefers-reduced-motion handling. Use whenever you add, reuse, or
  reason about an entrance/exit transition, reveal, or hover lift — "fade in/out",
  "animate-fade-in", "animate-fade-out", "transition", "animate", "reveal", "collapse",
  "slide in", "reduced motion", "matchMedia", "useSyncExternalStore for media query",
  "add a motion token", or "--animate-* token". Pairs with the tailwindcss skill (token
  mechanics) and the react / react-testing-library skills.
---

# Motion Skill — alfred project

> Motion in alfred is **restrained** (SPEC §5.4): ambient glow, gentle reveals, hover lift,
> smooth expand/collapse — and it **always respects `prefers-reduced-motion`**. Spend
> animation where it clarifies a state change; never as decoration. Over-animation reads as
> AI-generated. Less is more.

---

## Mental Model

**Animations are design tokens, just like colors.** In Tailwind v4 every `--animate-*`
custom property declared in `@theme` emits an `animate-<name>` utility *and* is available as
a CSS variable. So a reusable fade isn't a one-off class string copied between components —
it's a named token defined once in `frontend/app/globals.css` and applied everywhere by name.
This is the same "token = utility" insight the tailwindcss skill describes for `--color-*`,
applied to motion.

The project's reusable motion tokens (defined in `globals.css`):

| Token | Utility | What it does |
|---|---|---|
| `--animate-fade-in` | `animate-fade-in` | opacity 0 → 1 over 200ms ease-out |
| `--animate-fade-out` | `animate-fade-out` | opacity 1 → 0 over 150ms ease-in (exit is slightly quicker than entry — feels responsive). Ends with `forwards` so it **holds** opacity 0 — see the flash pitfall below. |
| `--animate-check-pop` | `animate-check-pop` | snappy scale overshoot (0.7 → 1.18 → 1) over 200ms — a responsive "press" for a control flipping to active (the task checkbox). |
| `--animate-expand-y` | `animate-expand-y` | `grid-template-rows: 0fr → 1fr` over 300ms ease-out — expands a grid-rows wrapper from 0 height to its natural content height. Pair with `overflow-hidden` inner div (same two-div pattern as the grid-rows transition). |
| `--animate-collapse-y` | `animate-collapse-y` | `grid-template-rows: 1fr → 0fr` over 300ms ease-out, `forwards` so it **holds** at 0fr between `animationend` and the React unmount (same flash-prevention reason as `fade-out`). |

They are defined with a **plain `@theme`** block (not `@theme inline`) because they don't
reference dark-mode variables:

```css
@theme {
  --animate-fade-in: fade-in 200ms ease-out;
  --animate-fade-out: fade-out 150ms ease-in forwards; /* `forwards` is load-bearing — see pitfall */

  @keyframes fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes fade-out {
    from { opacity: 1; }
    to   { opacity: 0; }
  }
}
```

> Keyframes live **inside** `@theme` in v4 — Tailwind emits them alongside the matching
> `--animate-*` token. Don't put them in a bare stylesheet block and expect the
> `animate-*` utility to pick them up.

---

## Decision Tree

**"Do I want an animation or a transition?"**

```
Is this a one-shot state change on mount/unmount (reveal, enter, exit)?
  → Animation. Use an `--animate-*` token: animate-fade-in / animate-fade-out.
Is this a continuous property change driven by a state class (hover, focus, open)?
  → Transition. Use `transition-* duration-* ease-*` (no keyframes needed).
     e.g. hover lift: `transition-transform duration-150 hover:-translate-y-0.5`
```

**"I need a fade that I'll reuse — where does it go?"**

```
Reusable across components (fade, slide, scale reveal)?
  → Add an `--animate-*` token to @theme in globals.css (see "Adding a token" below),
    then apply `animate-<name>`. Do NOT inline a bespoke @keyframes in a component.
One-off, component-specific easing/timing on a transition?
  → A class string in the component is fine (transitions aren't tokenized).
```

**"This animation mounts/unmounts content. How do I keep the exit visible?"**

```
Content is conditionally rendered ({open && <X/>})?
  → A plain unmount kills the exit animation (element is gone before it can fade).
    Use the reveal/collapse pattern below: stay mounted through fade-out, unmount on
    animationend, and unmount immediately when reduced motion is on.
```

---

## Plain-English → Pattern Table

| When you need to... | Use this pattern | Key things to know |
|---|---|---|
| **Fade something in on mount** | `className="animate-fade-in motion-reduce:animate-none"` | The `motion-reduce:animate-none` guard is mandatory (see Pitfalls). |
| **Fade + slide a panel in** | compose with tw-animate-css: `animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none` | `animate-in` / `slide-in-*` come from `tw-animate-css` (already imported). Our `--animate-fade-*` tokens are for the pure-opacity reusable case. |
| **Reveal/collapse a region with a real fade both ways** | The reveal/collapse pattern (below) | Keep mounted through the exit; unmount on `animationend`; honour reduced motion. |
| **Reveal/collapse a region with a height expand both ways** | Use `animate-expand-y` / `animate-collapse-y` on a `grid` wrapper, with `overflow-hidden` inner div (same two-div as the grid-rows transition). `onAnimationEnd` with `event.target === event.currentTarget && !open` unmounts on collapse. | Analogous to the fade reveal/collapse pattern but for height. `forwards` on collapse-y holds height at 0 between `animationend` and unmount (same flash reason as fade-out). |
| **Smooth height expand/collapse (height: 0 → auto)** | CSS grid-rows trick (below) | `height: 0 → auto` can't be transitioned directly; `grid-template-rows: 0fr → 1fr` can. Drive it with a **`transition`** (class toggle), and for a _collapse_ prefer **`ease-out`** — `ease-in` crawls at the start and reads as sluggish. |
| **Collapse a row's height to 0 (and animate it out of a list that filters it on a state change)** | The animate-then-commit pattern (below): the grid-rows transition + commit the store mutation on `transitionend` | The store change unmounts the row instantly, so you can't animate _after_ it — defer the mutation. Used by `task-row.tsx` completion. |
| **Drive a reveal that another part of the tree can also close** (e.g. a header logo that resets a page section) | Make the open state **URL-driven** (`/` vs `/?view=inbox`) and pass it as a prop; navigate with `<Link>` | URL state is shared across component trees for free — no context/prop-drilling. The page re-renders with the new prop and the section animates. |
| **Read `prefers-reduced-motion` in a component** | `usePrefersReducedMotion()` from `@/lib/use-prefers-reduced-motion` | Shared hook (don't re-inline the `matchMedia` plumbing). Lint-clean and SSR-safe; gate one-shot motion on it and take the immediate path when it returns `true`. |
| **Hover lift on a card/row** | `transition-transform duration-150 ease-out hover:-translate-y-0.5 motion-reduce:hover:translate-y-0` | Transition, not animation. Still needs a `motion-reduce:` guard. |
| **Animate a list whose rows _reorder_** (a DOM sibling reorder, e.g. a priority re-rank) | The FLIP `useFlipList` hook (below) | CSS can't transition a sibling reorder on its own. FLIP measures before/after rects and glides each row. Gate on reduced motion (rows snap). |
| **Animate a brand-new row _entering_ a visible list** (a capture, a new subtask) | `AnimatedHeightEnter`, keyed on the optimistic temp id (the row-entrance pattern below) | Height expands `0fr → 1fr` (pushing the rows below down) + content fades/slides from above. Keyframes, so they play once on mount; the temp→server-id reconcile remounts the row and ends the one-shot. |

---

## The reveal / collapse pattern (fade in → mount, fade out → unmount)

This is the canonical alfred pattern for "show this region with a fade, hide it with a fade".
Used by `components/tasks/inbox-screen.tsx` (the landing ⇆ inbox reveal).

```tsx
'use client';
import * as React from 'react';

// open is typically URL-driven (a prop derived from a search param) so something
// outside this tree — a header link — can close it just by navigating.
export function Reveal({ open, children }: { open: boolean; children: React.ReactNode }) {
  const prefersReducedMotion = usePrefersReducedMotion();

  // Keep mounted while it fades out. Derive the mount flag DURING RENDER (React's
  // recommended pattern over setState-in-effect, which the react-hooks lint forbids):
  const [rendered, setRendered] = React.useState(open);
  if (open && !rendered) {
    setRendered(true);                 // opening: mount now, then fade in
  } else if (!open && rendered && prefersReducedMotion) {
    setRendered(false);                // closing w/ no animation to wait on: unmount now
  }

  const handleAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    // Ignore animations bubbling from children; only our own fade-out unmounts.
    if (e.target === e.currentTarget && !open) setRendered(false);
  };

  if (!rendered) return null;
  return (
    <div
      className={open ? 'animate-fade-in motion-reduce:animate-none'
                      : 'animate-fade-out motion-reduce:animate-none'}
      onAnimationEnd={handleAnimationEnd}
      aria-hidden={!open}
    >
      {children}
    </div>
  );
}
```

`usePrefersReducedMotion` is the shared hook at `frontend/lib/use-prefers-reduced-motion.ts`
(`useSyncExternalStore` over `matchMedia('(prefers-reduced-motion: reduce)')`, lint-clean +
SSR-safe — server snapshot returns `false`). Import it; don't re-inline the plumbing.

Why each piece:
- **Mount-during-render** (not `useEffect`): the `react-hooks/set-state-in-effect` rule errors
  on synchronous `setState` inside an effect. Conditionally setting state during render to
  derive it from props is the React-blessed alternative and does not loop (the condition is
  false after the update).
- **`onAnimationEnd` + `e.target === e.currentTarget`**: child animations bubble; without the
  guard a child's animation end would unmount the region early.
- **Reduced-motion immediate unmount**: with `motion-reduce:animate-none` there is *no*
  fade-out, so `animationend` never fires — the region would be stranded on screen. Detecting
  reduced motion lets us unmount it right away instead.
- **`forwards` fill-mode on the fade-out** (in the token shorthand): without it the exit
  flashes — see the dedicated pitfall below. This is what makes "fade out then unmount" look
  clean instead of stuttering.

---

## The animate-then-commit pattern (exit a row that a store removes on a state change)

When an item's exit is driven by a **store mutation that filters it out of the view** (e.g.
completing a task flips `status` and `useScopedTasks` drops it), the row **unmounts the instant
the store updates** — there's nothing left to animate. The reveal/collapse pattern above doesn't
apply (it owns its own `open` prop); here the unmount is the data layer's call. So **invert the
order: play the exit first, commit the mutation last.** Used by `components/tasks/task-row.tsx`
(completion: checkbox pop → height collapse → text fade, then `completeTask`).

- **Local `isCompleting` state plays the exit.** A click sets it `true`; the row keeps rendering
  (still "active" in the store) and applies the exit classes. The store mutation is **not** called
  yet.
- **Collapse the height with the grid-rows _transition_ below** — a one-shot `1fr → 0fr` gated on
  `isCompleting`, with `ease-out` and a small `delay-` so the checkbox pop leads. A transition (not
  a keyframe) so the curve matches the subtask collapse and eases responsively; a keyframe
  collapse with `ease-in` measurably crawls at the start and reads as sluggish.
- **Commit on `transitionend`**, guarded by **both** `e.propertyName === 'grid-template-rows'`
  **and** `e.target === e.currentTarget` — the inner subtask grid _also_ transitions
  `grid-template-rows` and bubbles up, as do child colour fades. The mutation's optimistic patch
  then filters the row out — it unmounts already collapsed to 0 height, so no jump.
- **Commit exactly once, with an unmount fallback.** Guard the mutation behind a
  `hasCompletedRef`, and **also call it from an unmount effect's cleanup** when `isCompleting` —
  otherwise navigating away mid-collapse (the row unmounts before `transitionend`) **silently drops
  the mutation**. (Effect cleanup runs only for client-side unmounts, not full reloads — fine: a
  full reload mid-exit just no-ops the click.)
- **Reduced motion → commit immediately**, skipping the animation entirely (no transition means no
  `transitionend` to wait on). Branch on `usePrefersReducedMotion()`.

**Testing it** (jsdom runs no CSS transitions, so the commit's trigger never fires on its own):
- Put a `data-testid` on the collapse wrapper and **fire its `transitionend` by hand**. **jsdom has
  no `TransitionEvent`**, so `fireEvent.transitionEnd(el, { propertyName })` silently **drops the
  `propertyName`** — build the event yourself so the guard is actually exercised:
  ```ts
  const e = new Event('transitionend', { bubbles: true });
  Object.defineProperty(e, 'propertyName', { value: 'grid-template-rows' });
  fireEvent(wrapper, e);
  ```
  Firing it on a child, or with a different `propertyName`, must **not** commit (proves the guards).
- Test the **reduced-motion** branch by overriding `matchMedia` to `matches: true` (see the jsdom
  gotcha below); there completion is synchronous, no `transitionend` needed.

### The store-modeled exit (a queue that animates its own removals)

When the data is a **store-owned queue** (the toast queue), keep the animate-then-commit logic
in the **store**, not each item. `dismissToast` doesn't filter the toast out — it flips a
`leaving` flag (the toast stays queued) and schedules the real removal after an `EXIT_MS`
constant matched to the exit duration. The auto-expire timer calls the same path, so both the
close button and auto-dismiss animate out; re-flagging an already-`leaving` toast is idempotent.
The viewport then needs no `isCompleting`/`transitionend` plumbing — it just renders the
`tw-animate-css` enter classes for a `visible` toast and the exit classes (+ `fill-mode-forwards`,
see the pitfall above) for a `leaving` one. Removal is timer-driven, **not** `animationend`-driven,
so reduced motion (`motion-reduce:animate-none`) simply holds the toast for `EXIT_MS` then drops
it — no stranded toast, no `animationend`-that-never-fires branch. Used by `toast-store.tsx` +
`toast-viewport.tsx`.

A **sound cue counts as motion**: gate it on `prefers-reduced-motion` too (silent when reduced).
Fire it from the **imperative store action** (the single `showToast` call), not a mount effect —
an effect double-fires under StrictMode, playing the chime twice. Read `matchMedia` directly
there (always-defined client-side, per the pitfall above).

---

## The grid-rows expand/collapse pattern (height: 0 → auto without JS measurement)

CSS cannot transition `height: auto`. The `grid-template-rows: 0fr → 1fr` trick gives smooth height animation with no JavaScript measurement. Used by `components/tasks/task-row.tsx` for the subtask list.

```tsx
{(hasChildren || showExtra) && (
  <div
    className={cn(
      'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
      isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
    )}
    aria-hidden={!isOpen}
    inert={!isOpen}   // prevents keyboard focus when collapsed
  >
    <div className="overflow-hidden">
      <ul
        className={cn(
          'transition-opacity motion-reduce:transition-none',
          isOpen ? 'opacity-100 duration-200 delay-75' : 'opacity-0 duration-100',
        )}
      >
        {children}
      </ul>
    </div>
  </div>
)}
```

Key points:
- **Drive it with a `transition` + `ease-out`, not a keyframe.** A keyframe interpolating the `fr` track *does* honour its timing function, but `ease-in` on a collapse crawls at the start and reads as "weirdly linear"/sluggish; `ease-out` (brisk start, settle) is what feels right. A `transition` toggled by a class is also simpler than a token for this on/off case.
- **Two-div wrapper**: outer `grid` div drives the height via `grid-template-rows`; inner `overflow-hidden` div clips the content to the track height. Without `overflow-hidden`, content protrudes out of the collapsed track.
- **`aria-hidden` + `inert`**: collapsed content stays in the DOM (for animation), but both attributes together remove it from the AT and prevent keyboard focus. `inert` alone would suffice for both, but `aria-hidden` is what RTL's `queryByRole` tests check.
- **Opacity on the inner element**: stagger opacity slightly behind height (`delay-75` on open, `duration-100` on close) for a natural "slide open then reveal" feel.
- **`motion-reduce:transition-none` on both elements**: disables all transitions for reduced-motion users (no height, no opacity).
- **Content stays mounted**: unlike the reveal/collapse pattern, there's no mount/unmount — the element is always in the DOM when `hasChildren || showExtra` is true. This means no `animationend` logic needed.

### Testing with RTL and Playwright

RTL's `queryByRole` respects `aria-hidden`, so when the wrapper has `aria-hidden={true}`, `queryByRole('list', { name: 'Subtasks' })` returns null — use that to assert hidden state instead of `queryByText`.

Playwright's `toBeHidden()` checks CSS properties (`display: none`, `visibility: hidden`, zero bounding box) **but does NOT check inherited opacity**. `getComputedStyle(span).opacity` is `1` even if an ancestor `<ul>` has `opacity: 0`, because CSS opacity doesn't cascade via `getComputedStyle`. The grid-rows + overflow-hidden visually hides the element but Playwright still sees it as "visible". Fix: use Playwright's `getByRole` (which respects `aria-hidden`) instead of `getByText` to assert the collapsed state:

```ts
// ✗ fails — Playwright sees the <span> as visible even with opacity:0 on ancestor
await expect(page.getByText('Child task')).toBeHidden();

// ✓ correct — getByRole respects aria-hidden; 0 matches = not visible
await expect(page.getByRole('list', { name: 'Subtasks' })).not.toBeVisible();
```

---

## The row-entrance pattern (animate an optimistically-inserted row in)

When the user adds a row to a *visible* list — a captured inbox item, a new subtask — it
should grow in and push the rows below it down, not pop into place. Use
`components/atoms/animated-height-enter.tsx` (`AnimatedHeightEnter`): an outer `grid` running
`animate-expand-y` (`grid-template-rows: 0fr → 1fr`, so the row's own height pushes its
siblings down) wraps an inner `overflow-hidden` clip and a fade + `slide-in-from-top-2` (the
content drops in from above). Both are **keyframes**, so they fire once on mount and never
replay on a re-render. Used by `task-row.tsx`.

- **Trigger on the optimistic temp id** (`isTempId(node.id)`), not a mount or a render-diff.
  A row carries a temp id only between its store insert and the server reconcile, so exactly
  the freshly-added rows animate — a server-seeded row (page load, view switch) already has
  its real id and stays still. This buys "only when the list is visible" for free: an
  unmounted list never plays it.
- **The reconcile remount snaps to rest — that's the intended degradation, not a bug to
  engineer around.** Reconcile `replace`s the temp id with the server id, changing the React
  key, so the row remounts *without* the wrapper (its real id isn't a temp id); if the server
  answers mid-animation the row settles to full height. Don't try to carry the entrance across
  the remount with a transferred "still-entering" flag — a fresh keyframe on the remounted
  element **restarts from 0fr** (a worse jump than the snap). Snap-to-final is the better
  failure mode, and slowing the create response is how a demo capture keeps the full entrance
  on screen.
- **Reduced motion:** `motion-reduce:animate-none` on both layers leaves the row at rest;
  nothing to strand, since removal isn't `animationend`-driven (unlike the reveal/collapse).

## The FLIP list-reorder pattern (animate a sibling reorder)

When a list **re-sorts** — rows swap places (e.g. the Backlog's `priority` swap, ALF-35) — the
DOM siblings reorder, which CSS can't transition on its own (and there's no Framer Motion in the
stack). Use **FLIP** (First → Last → Invert → Play): the shared hook
`frontend/lib/hooks/use-flip-list.ts` (`useFlipList`).

```tsx
const items = useBacklog(...);                       // the (re)sorted list
const register = useFlipList(items.map((i) => i.id)); // keys in CURRENT render order
// each row: <li ref={register(item.id)}> … </li>    // forwardRef the root to the registrar
```

In a `useLayoutEffect` it reads each tracked row's previous and new `getBoundingClientRect`
(First/Last), sets a no-transition `translateY(Δ)` so the row looks un-moved (Invert), then on the
next `requestAnimationFrame` clears the offset under `transform 200ms ease-out` (Play) so the rows
glide. Key things:

- **Reduced motion:** the hook gates the whole effect on `usePrefersReducedMotion()` — when reduced
  it skips the transform entirely (rows snap), so there's no transition to strand.
- **Keys are the identity:** pass them in current render order; only rows present before *and* after
  animate (entering/leaving rows are left alone). Forward the registrar ref to the row's root.
- **Only animate a genuine reorder — a same-order re-render must be a no-op.** An optimistic store
  swap is followed by a **server reconcile** that re-renders with the *same* order (the reconcile
  re-applies the confirmed values). If the layout effect re-measures/re-inverts on that render it
  **interrupts the in-flight transition** — the row freezes at its old slot, then jumps ¾ of the way
  in one frame, then eases the rest (classic mid-flight jank). Track the previous key order and
  **bail out when it's unchanged**; only run the FLIP when the order actually changed.
- **Measure "Last" cleanly and store THOSE rects.** Read each new slot *after* clearing any leftover
  `transform`/`transition`, and save that clean measurement as the next baseline. Snapshotting
  *after* applying the invert records the inverted (old) positions, so alternating swaps compute
  Δ=0 and snap. (This pairs with the bail-out above; both were found via the `debug-animations`
  probe and pinned by `e2e/code-backlog-reorder-flip.spec.ts`, which asserts no frame covers >40%
  of the journey.)
- **`react-hooks/immutability` (React Compiler):** an object passed as `useRef`'s initial argument
  is frozen, so the hook would be flagged for mutating tracked nodes' `.style`. Create the Maps
  **lazily** (`const m = (ref.current ??= new Map<…>())`) instead of `useRef(new Map())`, and type
  each `new Map<K, V>()` so the nodes don't widen to `any`.
- **jsdom has no layout:** `getBoundingClientRect` is all-zero, so the transform never fires under
  Jest — assert the row *order*, not the transform. To actually measure the glide, sample
  `transform` over frames in Playwright (the `debug-animations` skill).

## Common Pitfalls

- **Always pair `motion-reduce:animate-none` with every `animate-*`** (and
  `motion-reduce:transition-none` with every `transition-*`). Required by SPEC §5.4 and the
  tailwindcss skill. No exceptions, including opacity fades.

- **`motion-reduce:animate-none` silently breaks `animationend`-driven unmounts.** If your
  unmount waits on the fade-out animation, reduced-motion users get no animation and thus no
  event. Handle that branch explicitly (immediate unmount), as in the pattern above.

- **A fade-out that unmounts on `animationend` flashes back to full opacity for one frame
  unless its animation uses `animation-fill-mode: forwards`.** Default fill-mode is `none`:
  the moment the fade finishes, the element reverts to its *base* opacity (1) — and there's a
  one-frame gap between `animationend` firing and React committing the unmount, so that fully
  opaque frame paints. The result is a visible blink right before the element disappears.
  `forwards` makes the element **hold** its final keyframe (opacity 0) through that gap, so no
  flash. **The keyword must live inside the token's `animation` shorthand**
  (`--animate-fade-out: fade-out 150ms ease-in forwards`) — applied as a *separate* utility
  (e.g. `[animation-fill-mode:forwards]`) it's reset to `none` by the `animation` shorthand the
  `animate-fade-out` utility expands to, so it silently does nothing (this is exactly why a
  "just add `forwards`" attempt fails). Demo: `docs/demos/inbox-fade-stutter.md`. To *catch or
  measure* this class of one-frame glitch, sample the element frame by frame — see the
  `debug-animations` skill.

- **`tw-animate-css`'s `animate-out` reverts unless you add `fill-mode-forwards`.** Its
  `--animate-out` shorthand ends with `var(--tw-animation-fill-mode, none)`, so a compound
  `animate-out fade-out-0 slide-out-to-bottom-2` snaps back to full opacity the frame after it
  finishes. Unlike the project's `--animate-fade-out` token (whose shorthand *hardcodes*
  `forwards`, so a separate fill-mode utility is overridden), here the standalone
  `fill-mode-forwards` utility **is** the intended companion — it sets the var the shorthand
  reads, so it holds. Needed **even when removal is timer-driven** (a store `leaving` phase +
  delayed unmount — the store-modeled exit below): if the exit animation and the removal timer
  are the same length, the
  revert frame can still paint in the gap before the unmount commits. Used by `toast-viewport.tsx`.

- **`onAnimationEnd` bubbles from descendants.** Guard with
  `event.target === event.currentTarget` so a child's animation doesn't trigger parent logic.

- **Don't inline bespoke `@keyframes` in a component for something reusable.** Add an
  `--animate-*` token to `@theme` in `globals.css` so it becomes a shared `animate-*` utility.

- **Don't reach for `useEffect` to mirror a prop into state for an animation.** Derive it
  during render (the reveal pattern). An effect both lags by a frame and trips the
  `react-hooks/set-state-in-effect` rule.

- **`globalThis.matchMedia` is typed as always-defined** in the DOM lib, so `matchMedia?.(…)`
  and `… ?? false` are flagged by `@typescript-eslint/no-unnecessary-condition`. Call it
  directly inside effects / store snapshots (which only run client-side anyway).

---

## Testing motion-aware components (jsdom gotcha)

**jsdom does not implement `window.matchMedia`.** Any component that reads a media query —
e.g. `prefers-reduced-motion` via `useSyncExternalStore` — throws
`matchMedia is not a function` the moment it renders under Jest.

The fix is a one-time stub in the shared setup, **already wired** in
`frontend/jest.setup.ts` (defaults to "no match" = motion allowed):

```ts
const createMatchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }) as unknown as MediaQueryList;
globalThis.matchMedia = createMatchMedia;
```

Notes:
- Use `jest.fn()` for the listener methods — **not** `() => {}`. `unicorn/no-useless-undefined`
  rewrites `() => undefined` into `() => {}`, which then trips `@typescript-eslint/no-empty-function`.
  `jest.fn()` sidesteps both.
- This is **test infrastructure, not a guardrail bypass** — it supplies a browser API jsdom
  omits; the component is still fully exercised. To test reduced-motion behaviour explicitly,
  override `globalThis.matchMedia` within a test to return `matches: true`.
- The Storybook **test-runner** runs real Chromium, where `matchMedia` exists — this stub is a
  jsdom/Jest concern only.

---

## What Was Deliberately Left Out

- **`tw-animate-css` internals.** `animate-in` / `fade-in-0` / `slide-in-*` are available from
  the imported `tw-animate-css` package; their keyframe authoring is out of scope. Use them
  for compound enter/exit (fade+slide); use the `--animate-fade-*` tokens for the pure-opacity
  reusable case.
- **Spring / physics libraries (Framer Motion, etc.).** Not in the stack. CSS animations +
  transitions cover alfred's restrained motion.
- **Scroll-reveal / IntersectionObserver choreography.** Not currently needed; add here if it
  ever is.
