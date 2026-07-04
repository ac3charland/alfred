import { ALFRED_FOCUS_ITEM_EVENT } from '@/components/tasks/alfred-link';

/**
 * The task we've just navigated to whose row should ring itself once it appears. A jump across
 * views (By-Priority → a folder) switches the view *before* the destination row mounts, so a bare
 * event dispatched at click time fires into the void — the row's listener isn't attached yet. We
 * therefore stash the target here: a row that is already mounted catches the event below
 * (same-view, e.g. global search within the current folder), while a row mounting *after* the
 * switch claims the pending id on mount (see `useFocusItemHighlight`). Whichever happens first
 * consumes it, so the row rings exactly once.
 */
let pendingFocusId: string | null = null;

/**
 * Claim the pending focus target if it is `id`, clearing it so it fires only once. Called both by a
 * freshly-mounted row (the cross-view path) and by the live event handler (the same-view path).
 */
export function consumeTaskFocus(id: string): boolean {
  if (pendingFocusId !== id) return false;
  pendingFocusId = null;
  return true;
}

/**
 * Jump to the task with `id`, living at the client-side view `href` (see `taskDestination`): record
 * it as the pending focus target, switch to that view via a history push, then fire the row-focus
 * event for any already-mounted row. The destination row scrolls itself into view and rings briefly
 * (`useFocusItemHighlight`) whether it was already on screen or mounts as a result of the switch.
 * Shared by every "go to this task" affordance — global search and the By-Priority list.
 */
export function navigateToTaskAndFocus(id: string, href: string): void {
  pendingFocusId = id;
  globalThis.history.pushState(null, '', href);
  globalThis.dispatchEvent(new CustomEvent(ALFRED_FOCUS_ITEM_EVENT, { detail: { id } }));
}
