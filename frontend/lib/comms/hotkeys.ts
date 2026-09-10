/**
 * The app's first row-level keyboard convention, written to be reused rather than to serve one
 * list: a queue of rows where one is selected, and the selected row has verbs.
 *
 * Two rules make it safe to hang off `document` instead of a focused element, which is what
 * lets a row respond while the page's focus is wherever the last click left it:
 *
 * - a keystroke aimed at TEXT is never a command — an input, a textarea, a contenteditable;
 * - a keystroke inside an open overlay belongs to the overlay — a Radix menu or dialog runs
 *   its own type-ahead and its own Escape, and a second interpretation would fight it.
 *
 * A chord (⌘/ctrl/alt) is likewise never a row verb: those belong to the browser and to the
 * command palette.
 */

/** What a keystroke means to a row list. */
export type RowHotkeyAction =
  /** Move the selection one row down the list. */
  | 'next'
  /** Move the selection one row up. */
  | 'previous'
  /** Open the selected row at its source. */
  | 'open'
  /** Spin the selected row into an Inbox item. */
  | 'inbox'
  /** Clear the selected row as asking nothing — the demotion correction. */
  | 'nothing'
  /** Clear the selected row as a real ask being left unanswered. */
  | 'not_replying'
  /** Open the selected row's tier menu. */
  | 'tier'
  /** Drop the selection entirely. */
  | 'deselect';

/** The shape this reads off a keyboard event — a plain object in tests, the real event live. */
export interface RowHotkeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

const KEYS: Record<string, RowHotkeyAction> = {
  j: 'next',
  arrowdown: 'next',
  k: 'previous',
  arrowup: 'previous',
  o: 'open',
  i: 'inbox',
  n: 'nothing',
  x: 'not_replying',
  t: 'tier',
  escape: 'deselect',
};

/** The overlays that own their own keyboard while open. */
const OVERLAY_SELECTOR = '[role="menu"],[role="dialog"],[role="listbox"]';

/** Elements whose keystrokes are text, never commands. */
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Is the keystroke going somewhere that owns it — a text field, or an open overlay? Read off
 * the event's own target rather than off document state, so the check is a pure function of
 * the event and stays true for a portalled overlay (Radix moves focus INTO its content, so its
 * keystrokes are targeted inside it however far away it is rendered).
 */
export function isHotkeyBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  if (TEXT_ENTRY_TAGS.has(target.tagName)) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;

  return target.closest(OVERLAY_SELECTOR) !== null;
}

/**
 * Which row action a keystroke is, or `undefined` for one that means nothing here — which is
 * most of them, so a caller can attach this to `document` and ignore everything else.
 */
export function rowHotkeyAction(event: RowHotkeyEvent): RowHotkeyAction | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined;
  if (isHotkeyBlocked(event.target)) return undefined;
  return KEYS[event.key.toLowerCase()];
}
