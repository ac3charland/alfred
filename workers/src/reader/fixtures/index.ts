/**
 * The committed Reader fixtures: four `messages.get?format=full` resources in Substack's shape.
 *
 * TypeScript modules rather than `.json` because the Worker's tsconfig has neither
 * `resolveJsonModule` nor Node types, and turning either on to make a test pass is the config
 * change CLAUDE.md forbids. They are hand-built from Substack's public email structure —
 * the implementation session has no mailbox — so they are the extractor's contract, not a sample
 * of reality; the checkpoint's eval over real mail is where that contract meets it.
 *
 * Nothing personal appears in any of them: every publication, address and byline is invented.
 *
 * The four cover one extraction branch each, which is why the set is worth iterating over as a set:
 * an HTML essay with a real post link behind two unusable anchors, a roundup reachable only by
 * its "view in browser" line, a plain-text post with no link at all, and platform mail that must
 * never reach the roster.
 */
import type { GmailMessage } from '../../comms/gmail-api';
import { ESSAY_MESSAGE } from './essay';
import { PLAIN_TEXT_ONLY_MESSAGE } from './plain-text-only';
import { PLATFORM_MAIL_MESSAGE } from './platform-mail';
import { ROUNDUP_VIEW_IN_BROWSER_MESSAGE } from './roundup-view-in-browser';

export { ESSAY_MESSAGE } from './essay';
export { PLAIN_TEXT_ONLY_MESSAGE } from './plain-text-only';
export { PLATFORM_MAIL_MESSAGE } from './platform-mail';
export { ROUNDUP_VIEW_IN_BROWSER_MESSAGE } from './roundup-view-in-browser';
export { encodeBody } from './encode';

/** One named fixture, as the extractor's suite and the eval script's `--fixtures` replay read it. */
export interface ReaderFixture {
  name: string;
  message: GmailMessage;
}

/** Every committed fixture, in the order a tick would meet them (oldest first). */
export const READER_FIXTURES: readonly ReaderFixture[] = [
  { name: 'essay', message: ESSAY_MESSAGE },
  { name: 'roundup-view-in-browser', message: ROUNDUP_VIEW_IN_BROWSER_MESSAGE },
  { name: 'plain-text-only', message: PLAIN_TEXT_ONLY_MESSAGE },
  { name: 'platform-mail', message: PLATFORM_MAIL_MESSAGE },
];
