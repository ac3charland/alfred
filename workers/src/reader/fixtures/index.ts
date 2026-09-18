/**
 * The committed Reader fixtures: five `messages.get?format=full` resources in Substack's shape.
 *
 * TypeScript modules rather than `.json` because the Worker's tsconfig has neither
 * `resolveJsonModule` nor Node types, and turning either on to make a test pass is the config
 * change CLAUDE.md forbids. Their SHAPE is taken from the owner's own mailbox — the anchor order,
 * the hidden preheaders, the RFC 2047 subjects, the MIME layout — and every word inside that shape
 * is invented: no real publication, byline, address, slug, subject or sentence appears in any of
 * them.
 *
 * Each covers one extraction branch, which is why the set is worth iterating over as a set: a post
 * in the live template whose only post link is `open.substack.com/pub/…/p/…` behind two redirect
 * wrappers, a roundup with no post path at all that is reachable only by its button's text, a
 * plain-text post with no link, platform mail that must never reach the roster, and a reaction
 * notification — the one mail that still carries a bare `/p/<slug>`, pointing at a post it is not
 * about, from a sender the roster must refuse twice over.
 */
import type { GmailMessage } from '../../comms/gmail-api';
import { ESSAY_MESSAGE } from './essay';
import { PLAIN_TEXT_ONLY_MESSAGE } from './plain-text-only';
import { PLATFORM_MAIL_MESSAGE } from './platform-mail';
import { REACTION_NOTIFICATION_MESSAGE } from './reaction-notification';
import { READ_IN_APP_MESSAGE } from './read-in-app';

export { ESSAY_MESSAGE } from './essay';
export { PLAIN_TEXT_ONLY_MESSAGE } from './plain-text-only';
export { PLATFORM_MAIL_MESSAGE } from './platform-mail';
export { READ_IN_APP_MESSAGE } from './read-in-app';
export { REACTION_NOTIFICATION_MESSAGE } from './reaction-notification';
export { encodeBody } from './encode';

/** One named fixture, as the extractor's suite and the eval script's `--fixtures` replay read it. */
export interface ReaderFixture {
  name: string;
  message: GmailMessage;
}

/** Every committed fixture, in the order a tick would meet them (oldest first). */
export const READER_FIXTURES: readonly ReaderFixture[] = [
  { name: 'essay', message: ESSAY_MESSAGE },
  { name: 'read-in-app', message: READ_IN_APP_MESSAGE },
  { name: 'plain-text-only', message: PLAIN_TEXT_ONLY_MESSAGE },
  { name: 'platform-mail', message: PLATFORM_MAIL_MESSAGE },
  { name: 'reaction-notification', message: REACTION_NOTIFICATION_MESSAGE },
];
