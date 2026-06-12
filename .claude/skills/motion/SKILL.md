---
name: motion
description: >
  Documents the alfred frontend's motion conventions: the reusable animation design tokens (the `--animate-*`
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
| `--animate-fade-out` | `animate-fade-out` | opacity 1 → 0 over 150ms ease-in (exit is slightly quicker than entry — feels responsive) |

They are defined with a **plain `@theme`** block (not `@theme inline`) because they don't
reference dark-mode variables:

```css
@theme {
  --animate-fade-in: fade-in 200ms ease-out;
  --animate-fade-out: fade-out 150ms ease-in;

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
| **Drive a reveal that another part of the tree can also close** (e.g. a header logo that resets a page section) | Make the open state **URL-driven** (`/` vs `/?view=inbox`) and pass it as a prop; navigate with `<Link>` | URL state is shared across component trees for free — no context/prop-drilling. The page re-renders with the new prop and the section animates. |
| **Read `prefers-reduced-motion` in a component** | `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` over `matchMedia('(prefers-reduced-motion: reduce)')` | Lint-clean (no setState-in-effect) and SSR-safe (server snapshot returns `false`). See the snippet below. |
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

`usePrefersReducedMotion`, lint-clean + SSR-safe:

```tsx
const QUERY = '(prefers-reduced-motion: reduce)';
const subscribe = (cb: () => void) => {
  const mql = globalThis.matchMedia(QUERY);
  mql.addEventListener('change', cb);
  return () => { mql.removeEventListener('change', cb); };
};
function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => globalThis.matchMedia(QUERY).matches,
    () => false, // server snapshot: assume motion allowed
  );
}
```

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

---

## Common Pitfalls

- **Always pair `motion-reduce:animate-none` with every `animate-*`** (and
  `motion-reduce:transition-none` with every `transition-*`). Required by SPEC §5.4 and the
  tailwindcss skill. No exceptions, including opacity fades.

- **`motion-reduce:animate-none` silently breaks `animationend`-driven unmounts.** If your
  unmount waits on the fade-out animation, reduced-motion users get no animation and thus no
  event. Handle that branch explicitly (immediate unmount), as in the pattern above.

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
