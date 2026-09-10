import { simpleParser } from 'mailparser';
import type { AddressObject, ParsedMail } from 'mailparser';

import { referenceIds } from './thread.ts';

/**
 * Turning raw RFC822 bytes into the handful of fields the ingest contract wants.
 *
 * The parser is a parameter rather than an import so a test can make one message fail without
 * hunting for bytes that break a particular mailparser version — and because "this message would
 * not parse" is a first-class outcome here, not an exception to be swallowed at the call site.
 */

/** Long enough for any real message, short enough that one runaway thread can't bloat a payload. */
export const MAX_BODY_CHARS = 20_000;

/**
 * The bulk-mail headers worth reporting. Their PRESENCE is all the daemon has an opinion on:
 * deciding a newsletter needs the priority-people roster, which lives server-side, so the filter
 * is the endpoint's to apply.
 */
const LIST_HEADER_KEYS = ['list-unsubscribe', 'list-id'] as const;

/** `Precedence` only means bulk mail for these two values; plenty of ordinary mail sets others. */
const BULK_PRECEDENCE = new Set(['bulk', 'list']);

export type MimeParser = (source: Buffer | string) => Promise<ParsedMail>;

/** The real parser, as the source uses it. */
export const parseMime: MimeParser = (source) => simpleParser(source);

export interface ExtractedMessage {
  messageId: string | undefined;
  inReplyTo: string | undefined;
  references: string[];
  subject: string | undefined;
  fromAddress: string | undefined;
  fromName: string | undefined;
  /** To + Cc, lower-cased and de-duplicated. */
  participants: string[];
  body: string;
  date: Date | undefined;
  hasAttachments: boolean;
  listHeaders: string[];
}

function addressesOf(value: AddressObject | AddressObject[] | undefined): string[] {
  if (value === undefined) return [];
  const objects = Array.isArray(value) ? value : [value];
  return objects.flatMap((object) =>
    object.value
      .map((entry) => entry.address?.toLowerCase())
      .filter((address) => address !== undefined),
  );
}

/**
 * A last-resort body for a message whose only part is HTML and whose parser produced no text of
 * its own. Block-level tags become line breaks so paragraphs stay apart; everything else is
 * dropped. It is a fallback, not an HTML renderer.
 */
export function htmlToText(html: string): string {
  return html
    .replaceAll(/<(script|style)[^>]*>.*?<\/\1>/gis, ' ')
    .replaceAll(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replaceAll(/<br\s*\/?>/gi, '\n')
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll(/[^\S\n]+/g, ' ')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}

function bodyOf(mail: ParsedMail): string {
  const text = mail.text ?? (typeof mail.html === 'string' ? htmlToText(mail.html) : '');
  return text.trim().slice(0, MAX_BODY_CHARS);
}

function listHeadersOf(mail: ParsedMail): string[] {
  const found: string[] = [];
  for (const key of LIST_HEADER_KEYS) {
    if (mail.headerLines.some((line) => line.key === key)) found.push(key);
  }
  const precedence = mail.headerLines.find((line) => line.key === 'precedence');
  if (precedence !== undefined) {
    const value = precedence.line
      .slice(precedence.line.indexOf(':') + 1)
      .trim()
      .toLowerCase();
    if (BULK_PRECEDENCE.has(value)) found.push('precedence');
  }
  return found;
}

/**
 * Returns `undefined` when the message could not be parsed at all. The caller still sends the
 * row — a skipped message is a false negative that leaves no trace anywhere — so the failure is
 * modelled as an absence of fields rather than as an error to be caught somewhere up the stack.
 */
export async function extractMessage(
  raw: Buffer | string,
  parse: MimeParser,
): Promise<ExtractedMessage | undefined> {
  let mail: ParsedMail;
  try {
    mail = await parse(raw);
  } catch {
    return undefined;
  }

  const from = mail.from?.value[0];
  const name = from?.name === undefined || from.name.length === 0 ? undefined : from.name;

  return {
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: referenceIds(mail.references),
    subject: mail.subject,
    fromAddress: from?.address?.toLowerCase(),
    fromName: name,
    participants: [...new Set([...addressesOf(mail.to), ...addressesOf(mail.cc)])],
    body: bodyOf(mail),
    date: mail.date,
    hasAttachments: mail.attachments.length > 0,
    listHeaders: listHeadersOf(mail),
  };
}
