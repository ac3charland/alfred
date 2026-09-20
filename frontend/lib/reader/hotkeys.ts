import { isHotkeyBlocked } from '@/lib/comms/hotkeys';

/**
 * The reading list's keyboard: which keystroke means what to a list of posts where one row is
 * selected and the selected row has verbs.
 *
 * Its own map rather than the queue's, because the two lists share only navigation — a post is
 * opened, archived and skimmed, not tiered or spun into an Inbox item. What IS shared is the rule
 * that decides whether a keystroke is a command at all (`isHotkeyBlocked`, imported): a keystroke
 * aimed at text or inside an open overlay belongs to that text or that overlay, and forking
 * fifteen lines of it would let the two copies drift apart exactly where a drift eats keystrokes.
 *
 * Letters only. Enter and Space are deliberately unbound: the row's card is a button and its
 * verbs are buttons and an anchor, none of which the blocked-target rule covers, so a
 * document-level Enter would fire alongside the focused control's own native activation and run
 * two things at once.
 */

/** What a keystroke means to the reading list. */
export type ReaderHotkeyAction =
  /** Move the selection one row down the list. */
  | 'next'
  /** Move the selection one row up. */
  | 'previous'
  /** Open the selected post at its source. */
  | 'open'
  /** Archive the selected post — or, in the archive, put it back. */
  | 'archive'
  /** Show or hide the selected row's overview panel. */
  | 'overview'
  /** Drop the selection entirely. */
  | 'deselect';

/** The shape this reads off a keyboard event — a plain object in tests, the real event live. */
export interface ReaderHotkeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

const KEYS: Record<string, ReaderHotkeyAction> = {
  j: 'next',
  arrowdown: 'next',
  k: 'previous',
  arrowup: 'previous',
  o: 'open',
  e: 'archive',
  v: 'overview',
  escape: 'deselect',
};

/**
 * Which reading-list action a keystroke is, or `undefined` for one that means nothing here —
 * which is most of them, so a caller can attach this to `document` and ignore everything else.
 * A chord (⌘ / ctrl / alt) is never a verb: those belong to the browser and the command palette.
 */
export function readerHotkeyAction(event: ReaderHotkeyEvent): ReaderHotkeyAction | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined;
  if (isHotkeyBlocked(event.target)) return undefined;
  return KEYS[event.key.toLowerCase()];
}
