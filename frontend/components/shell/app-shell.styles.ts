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

/**
 * The desktop sidebar's "Press ⌘K to go anywhere" affordance (ALF-207). Because the document
 * itself is what grows and scrolls (see `shellRootClass`), the `<aside>` stretches to match
 * whatever height the main content column reaches — on a long task list that's far taller than
 * one screen, so this hint, as the sidebar's last child, would otherwise render below the fold
 * of the *page* rather than the bottom of the *viewport*. `sticky bottom-0` keeps it pinned to
 * the visible viewport's bottom edge as the page scrolls, instead of drifting down with the
 * sidebar's stretched height; `bg-surface` repaints it opaque so nav content doesn't show
 * through once it's floating over whatever now sits behind it.
 */
export const sidebarShortcutHintClass =
  'sticky bottom-0 border-t border-border bg-surface px-4 py-2 text-xs text-muted-foreground/70';
