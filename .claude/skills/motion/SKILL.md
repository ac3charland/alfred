---
name: motion
description: >
  Documents the frontend's motion conventions: the reusable animation design tokens (the `--animate-*`
  theme tokens in globals.css, e.g. `animate-fade-in` / `animate-fade-out`), the pattern for
  revealing/collapsing content with a fade (mount → fade-in, fade-out → unmount), how to add a
  new motion token, and the jsdom `matchMedia` gotcha when testing motion-aware components. Use
  whenever you add, reuse, or reason about fade/slide reveals, expand/collapse, hover lift,
  entrance/exit transitions, or prefers-reduced-motion handling — "fade in/out", "transition",
  "animate", "reveal", "collapse", "slide in", "reduced motion", "useSyncExternalStore for media
  query", or "add a motion token". Pairs with the tailwindcss skill (token mechanics) and the
  react / react-testing-library skills (component + test mechanics).
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
