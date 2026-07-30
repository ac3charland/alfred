/**
 * Pure builders for the IN-APP links into the Code module — the client-side routes a
 * `ViewLink`, a `history.pushState`, or a toast navigates to. (The outward `claude.ai/code`
 * session links are a different concern and live in `lib/code/links.ts`.)
 *
 * Two destinations, both derived from stored ids: a project's board, and a single story on that
 * board. The story form appends the board's `?story=<ref>` deep-link seam, which opens that
 * story's detail modal on arrival (see `board.tsx`). Kept here rather than re-typed per call site
 * so the shape of the deep link is defined once — every entry point (a Backlog row, a search
 * result, a creation toast, a realtime move toast) hands the reader the same URL.
 */

/** The board for one project (`/code/<projectId>`). */
export function projectBoardHref(projectId: string): string {
  return `/code/${projectId}`;
}

/**
 * One story's board, with its detail modal open (`/code/<projectId>?story=<ref>`). The ref is
 * URL-encoded so a key with an unusual character survives the round trip. An empty ref (the
 * all-nullable view row's fallback) degrades to the plain board path rather than a dangling
 * `?story=`, which would resolve to nothing anyway.
 */
export function storyBoardHref(projectId: string, ref: string): string {
  const board = projectBoardHref(projectId);
  return ref === '' ? board : `${board}?story=${encodeURIComponent(ref)}`;
}
