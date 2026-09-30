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
 * The desktop sidebar (ALF-304): it stays put while the module's content scrolls. The document is
 * the scroller (see `shellRootClass`), so `sticky top-0` pins it and `h-dvh` holds it to one
 * visible viewport — its nav then scrolls inside its own `overflow-y-auto` pane. `self-start`
 * stops the flex row stretching it back to the page's full height, which would unpin it. 224px
 * (`md:w-56`) matches the mobile drawer's width.
 */
export const sidebarClass =
  'hidden md:sticky md:top-0 md:flex md:h-dvh md:w-56 md:shrink-0 md:flex-col md:self-start border-r border-border bg-surface';

/**
 * The top bar (ALF-304): pinned to the viewport top while the document scrolls beneath it.
 * `z-20` lifts it over in-list layers (the `z-10` drop gaps) but keeps it under the bulk bar
 * (`z-40`) and dialogs (`z-50`); `bg-surface` is opaque so content doesn't show through.
 */
export const shellHeaderClass =
  'sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-surface px-4';

/**
 * The desktop sidebar's "Press ⌘K to go anywhere" affordance (ALF-207). It must sit at the bottom
 * of the *viewport*, never the bottom of a long page; the sidebar being pinned at one viewport tall
 * (`sidebarClass`) with the nav pane taking the slack (`flex-1`) is what puts it there.
 */
export const sidebarShortcutHintClass =
  'border-t border-border bg-surface px-4 py-2 text-xs text-muted-foreground/70';
