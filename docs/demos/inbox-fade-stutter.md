# Inbox fade-out: fix the flash/stutter on close

*2026-06-12T04:42:46.044Z*

When the inbox closes it stays mounted and fades out (`animate-fade-out`, opacity 1 → 0 over 150ms), unmounting on `animationend` — see `frontend/components/tasks/inbox-screen.tsx`. The bug: the fade-out token had no `animation-fill-mode`, so it defaulted to `none`. The instant the fade finished, the element reverted to its **base** opacity (1) for the single frame before React removed it — a visible flash where the fully-opaque inbox blinks back into view right before it disappears.

Adding `forwards` as a *separate* utility doesn't work (a prior attempt): the `animate-fade-out` utility expands to the `animation` **shorthand**, which resets `animation-fill-mode` back to `none` — so depending on cascade order the keyword is silently dropped. The fix puts `forwards` **inside** the token's shorthand, where it can't be reset.

## The one-line fix

```bash
grep -n 'animate-fade-out:' frontend/app/globals.css
```

```output
94:  --animate-fade-out: fade-out 150ms ease-in forwards;
```

## Opacity, frame by frame, through the close (measured)

Computed opacity of the inbox panel, sampled every animation frame during the close. **Before** the fix — it fades to `0.000`, then rebounds to a full `1.000` for one frame at t=240ms. That rebound frame is the flash:

```bash
sed -n '13,16p' docs/demos/inbox-fade-stutter.before.txt
```

```output
t=192ms  opacity=0.340
t=208ms  opacity=0.178
t=224ms  opacity=0.000
t=240ms  opacity=1.000
```

**After** the fix — `forwards` holds the final keyframe, so once it reaches `0.000` it stays there until it unmounts. No rebound, no flash:

```bash
sed -n '13,16p' docs/demos/inbox-fade-stutter.after.txt
```

```output
t=192ms  opacity=0.177
t=208ms  opacity=0.000
t=224ms  opacity=0.000
t=240ms  opacity=GONE (unmounted)
```

## What it looks like

The fade-out itself, sampled at six points across its 150ms (full → gone). The panel dims smoothly and evenly — no frame jumps back to full opacity:

![Inbox fade-out filmstrip: the panel dims smoothly from full opacity to gone across six frames](inbox-fade-stutter-image-1.png)

And the full close as a screen recording (open → settle → close), captured through the Playwright mock-backend harness: [inbox-fade-stutter.webm](inbox-fade-stutter.webm). The list fades out and is simply gone — it never blinks back.
