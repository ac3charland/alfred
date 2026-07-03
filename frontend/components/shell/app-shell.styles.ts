/**
 * The app-shell root frame's sizing, extracted so the viewport-height choice is locked by a
 * unit test (the shell itself is a Server Component that's awkward to render in jsdom).
 *
 * Sized to the *dynamic* viewport (`min-h-dvh`), never the large viewport (`min-h-screen` =
 * 100vh). On mobile, `100vh` is the address-bar-retracted height, so a landing screen sized to
 * it is taller than the visible area whenever the browser chrome is showing — the page
 * overflows and scrolls before there is anything below the fold to scroll to. `dvh` tracks the
 * currently-visible viewport, so the landing fits exactly and the page only grows (and scrolls)
 * once the inbox list is opened. `min-h-*` (not `h-*`) keeps the frame growable so the document
 * — not an inner pane — is what scrolls; a swipe over the task list must move the page.
 */
export const shellRootClass = 'flex min-h-dvh bg-background';
