---
name: debug-animations
description: >
  A non-invasive way to debug what an element does DURING a transition by sampling
  a value (computed style, bounding rect, attribute) every animation frame from the
  live page via Playwright — no instrumentation in app code.
  Use it to catch transient, sub-perceptual glitches that final-state
  assertions, jsdom, and a single screenshot miss: a one-frame flash/flicker on
  enter/exit, layout shift or jank, an animation restart, wrong easing, a fill-mode
  revert. Trigger on "looks janky but the final state is correct", "flash",
  "flicker", "stutter", "sample opacity/transform over time",
  "getComputedStyle over time". Pairs with the playwright skill
  (the harness) and the motion skill.
---

# debug-animations — sample the page frame by frame

## What it is and why

A **runtime probe** drives the real app and records a value **once per animation
frame** while a transition plays, then hands the time series back to Node. Its
defining property: it adds **nothing to the app**. The sampler is injected into the
running page with `page.evaluate`; the components ship exactly as they are.

That matters because the bugs it finds live **between** a transition's start and end
states — the frames a normal test never looks at:

- A normal e2e/RTL test asserts the **final** state ("the list is gone"). It passes
  even if the list flashed fully opaque for one frame on the way out.
- **jsdom** (Jest/RTL) has no layout or compositor, so a render-pipeline glitch
  (a `fill-mode` revert, a reflow) simply doesn't exist there.
- A **screenshot** catches one moment; a **video** shows motion but you can't read
  exact values off it, and a one-frame blip is easy to miss.

The probe samples ~60×/second and gives you a readable timeline, so a one-frame
glitch shows up as one anomalous row. This is exactly how the inbox fade-out flash
was found and pinned (see `docs/demos/inbox-fade-stutter.md`):

```
t= 208ms  opacity=0.178
t= 224ms  opacity=0.000   ← faded out
t= 240ms  opacity=1.000   ← the flash: one frame back at full opacity
t= 256ms  GONE            ← then it unmounts
```

## The helper

`frontend/e2e/support/probe.ts` — runs inside the e2e harness (so it gets the
logged-in session, the mock Supabase backend, and seeded data for free):

| Export | Use |
| --- | --- |
| `sampleDuring(page, options, trigger)` | The common case: start sampling, run `trigger` (a click/nav) while it samples, return the frames. |
| `startSampling` / `collectSamples` | The two halves, for when the action spans several steps. |
| `formatTimeline(frames)` | Render frames as the readable `t=…ms  key=value` timeline (debug output / demo docs). |

`options` is `{ selector, read, durationMs }`. `read` is what to capture each frame:

- `{ kind: 'style', props: ['opacity', 'transform'] }` — `getComputedStyle` values
  (note: resolved — `transform` comes back as a `matrix(…)`, colors as `rgb(…)`).
- `{ kind: 'rect', props: ['top', 'height'] }` — `getBoundingClientRect`, for
  **layout shift / jank**.
- `{ kind: 'attr', names: ['class', 'data-state', 'aria-hidden'] }` — attribute /
  state-machine transitions.

Each `ProbeFrame` is `{ t, values }`; **`values` is `null` when the element is
absent** that frame — a first-class signal (it's how the flash was pinned to the
gap *between* fade-end and unmount).

### Debug mode — eyeball the timeline

```ts
import { sampleDuring, formatTimeline } from './support/probe';

const frames = await sampleDuring(
  page,
  { selector: '[data-testid="inbox-reveal"]', read: { kind: 'style', props: ['opacity'] }, durationMs: 600 },
  () => page.getByRole('link', { name: 'Close inbox' }).click(),
);
console.log(formatTimeline(frames)); // read the frame-by-frame story
```

Run it as a throwaway spec through the harness (`npm run test:e2e -w frontend -- <file>`),
read the output, then **delete the spec** — it's a debugger, not a test.

### Guard mode — turn the finding into a regression test

The same frames, asserted instead of printed. The flash guard
(`frontend/e2e/inbox-fade.spec.ts`) is the worked example: it samples opacity across
the close and asserts it never climbs back up once it has faded below 0.2. Keep
guard specs — they're the back-pressure that stops the glitch returning.

## Writing a bespoke read

The `read` kinds cover the common cases without `eval`. When you need something they
don't express — read two elements, derive a value, watch `document.activeElement` —
inline the same rAF loop in a one-off `page.evaluate` (fire-and-forget into a page
global, click, then read the global back). That raw form is exactly what the helper
generalises; reach for it only when a custom per-frame computation needs it.

**Sampling a node across its own unmount needs a bespoke read — `selector` aliases.**
`sampleDuring` re-runs `document.querySelector(selector)` every frame, so a positional
selector (`li:first-child`, `li:nth-child(2)`) doesn't follow one node: the instant the
watched row unmounts, the sibling that slides into that slot matches instead, and the
timeline reads its full height/opacity as if nothing animated (the deleting row's collapse
is invisible). To watch a row through its exit — or a sibling as it shifts position — capture
the **element reference** up front in a bespoke `page.evaluate` and read that same node each
frame (use `document.contains(node)` for the present/GONE signal). A "pull the rows below up"
check is then cleaner as fresh before/after locator `boundingBox()` measurements than as
per-frame sampling, since those rows are reconciled to new DOM nodes on commit. Used by
`e2e/task-delete.spec.ts`.

## Limitations (state these when you report a finding)

- **~16ms granularity.** Sampling is per `requestAnimationFrame`, so a glitch shorter
  than a frame can alias. A one-frame *paint* (like the flash) is catchable; a
  sub-frame transient may not be.
- **Computed style, not painted pixels.** It reads what the style engine resolves,
  which the compositor can still diverge from (GPU layers, `will-change`,
  sub-pixel rounding). For pixel-true proof, pair it with a screenshot.
- **Needs the real-app harness for app bugs.** Run it through the Playwright
  mock-backend setup (auth + seeded data), not a bare page — see the playwright
  skill. Storybook works too for isolated-component motion.
- **It's a measurement, not a fix.** The probe localises *when* something goes wrong;
  the fix still lives in the code (and, ideally, a guard-mode spec to lock it in).

## Further reading

- `playwright` skill — the harness, the mock backend, locators, `page.evaluate`.
- `motion` skill — the animation tokens and the reveal/collapse pattern whose
  exit-flash this probe was built to catch.
- `docs/demos/inbox-fade-stutter.md` — the probe in anger: before/after timelines.
