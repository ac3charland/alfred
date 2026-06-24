/**
 * Play a short, soft chime via the Web Audio API — the audio cue for an `emphasis` toast
 * (a realtime code-move landing, see the toast store). Deliberately asset-free: a brief
 * oscillator + gain envelope, so there's nothing to bundle and the whole thing is trivially
 * mockable in tests. A no-op (and never throws) when `AudioContext` is unavailable — SSR or
 * an older browser — so callers can fire it unconditionally.
 *
 * Note the browser autoplay gate: Web Audio needs a prior user gesture, so the very first
 * chime on a page with zero interaction may be silently suppressed. That's an accepted
 * limitation (see the ALF-46 spec), not handled here.
 */
export function playToastSound(): void {
  // `AudioContext` is typed as always-defined in lib.dom, but is genuinely absent under SSR
  // and old browsers — a `typeof` guard checks runtime presence without tripping
  // `no-unnecessary-condition` (which a `?.`/`??` against the always-defined type would).
  if (typeof AudioContext === 'undefined') return;

  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    // A gentle, short sine "ding": a quick rise then an exponential fall to near-silence.
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.3);
    oscillator.addEventListener('ended', () => {
      void ctx.close();
    });
  } catch {
    // Audio is a non-critical enhancement; never let a Web Audio hiccup surface to the user.
  }
}
