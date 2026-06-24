---
branch: claude/magical-maxwell-p2e26g
---

# ALF-46 — Louder, animated real-time code toasts

*2026-06-23T20:06:06.842Z*

ALF-46 makes the realtime code-move toast loud and unmissable, and gives **every** toast a real glide in **and** out. Three parts: an `emphasis` toast variant (glowing teal border, bigger card, a soft Web Audio chime), a two-phase store dismissal so the exit can animate, and `tw-animate-css` slide+fade enter/exit classes. Only the realtime `factory_state`-change toast uses `emphasis`; the gate's "Created …" toast stays plain.

## Emphasis vs default — glow + size

The realtime toast (`emphasis`) renders a glowing accent-teal border (a new `glow-emphasis` utility, brighter than the ambient 0.15-alpha glows) and a larger card (`max-w-sm px-5 py-4 text-base`). The gate toast keeps the exact border/size it always had.

![](louder-realtime-toasts-image-1.png)

_Emphasis toast — teal glow, bigger card._

![](louder-realtime-toasts-image-2.png)

_Default toast — unchanged from before._

## Every toast now slides + fades — in **and** out

Previously a dismissed toast was filtered out of the store and unmounted instantly — it popped out with no animation. Now `dismissToast` marks the toast `leaving` (it stays in the queue), the viewport plays the `tw-animate-css` `animate-out` exit, and the store removes it after `EXIT_MS` (200ms). The `DISMISS_MS` auto-expire runs through the same `leaving → remove` path.

Here is the glide, captured against the live ToastItem — the emphasis toast slides + fades **in**, holds, then slides + fades **out**:

![emphasis toast sliding + fading in, holding, then sliding + fading out](louder-realtime-toasts-video-4.gif)

For the exact curve, the **debug-animations** probe samples the card's computed `opacity` and `translateY` once per animation frame (the same technique that pinned the inbox fade-out flash):

**Enter — slide up + fade in** (opacity 0→1, translateY 8px→0 over ~200ms):

    t=  0ms  opacity=0.000  translateY=8.0px
    t= 32ms  opacity=0.220  translateY=6.2px
    t= 65ms  opacity=0.576  translateY=3.4px
    t= 98ms  opacity=0.802  translateY=1.6px
    t=132ms  opacity=0.925  translateY=0.6px
    t=165ms  opacity=0.983  translateY=0.1px
    t=198ms  opacity=1.000  translateY=0.0px

**Exit — slide down + fade out** (opacity 1→0, translateY 0→8px over ~200ms), then holds hidden until removal:

    t=  7ms  opacity=1.000  translateY=0.0px
    t= 40ms  opacity=0.779  translateY=1.8px
    t= 73ms  opacity=0.424  translateY=4.6px
    t=107ms  opacity=0.198  translateY=6.4px
    t=140ms  opacity=0.075  translateY=7.4px
    t=174ms  opacity=0.016  translateY=7.9px
    t=207ms  opacity=0.000  translateY=8.0px
    t=240ms  opacity=0.000  translateY=8.0px   <- holds (fill-mode-forwards), no revert flash

Without `fill-mode-forwards` on the exit, `tw-animate-css`'s `animate-out` (fill-mode none) reverts to full opacity for a frame after the 200ms animation ends but before the `EXIT_MS` removal commits — a flash. `forwards` holds the toast hidden until it unmounts.

## Sound — a soft chime for emphasis toasts, reduced-motion-aware

Audio can't be screenshotted, so it's pinned by unit tests instead. When an `emphasis` toast is enqueued, the store calls `playToastSound()` (a short Web Audio oscillator + gain envelope — no bundled asset, a no-op when `AudioContext` is unavailable). It fires **once** per toast, from the single imperative `showToast` call, and is **silent** under `prefers-reduced-motion: reduce`. A `default` toast never plays a sound. See `lib/play-toast-sound.test.ts` and the `sound` block in `lib/stores/toast-store.test.tsx`.

> **Autoplay caveat:** browsers gate Web Audio behind a prior user gesture. The user launched the session and is interacting with the board, so the first realtime chime usually plays; on a page with zero interaction the browser may suppress it. Accepted limitation, not worked around here.
