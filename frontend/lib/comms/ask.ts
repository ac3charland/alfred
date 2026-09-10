import type { CommMessage } from '@/lib/types';

/** How much of a body may stand in for a missing ask before it is cut. */
export const ASK_FALLBACK_LENGTH = 120;

/**
 * What this message wants, in one line — the sentence a row leads with, and the title an Inbox
 * item takes when the obligation is spun off. It is the model's own ask wherever there is one:
 * the whole point of the module is that triage answers "what does this want from me" without
 * the owner opening anything.
 *
 * The fallbacks exist only for a row that never got a verdict — a decode failure, an exhausted
 * ceiling — where the subject, then the head of the body, is still more than nothing. A row
 * with none of the three says so rather than rendering blank, because an empty line reads as a
 * bug and a marked row is meant to read as a message alfred could not judge.
 *
 * Shared by the queue UI and the Inbox-item route so a spun-off item is titled with exactly
 * what the row said it was.
 */
export function askLine(message: CommMessage): string {
  const ask = message.ask?.trim();
  if (ask !== undefined && ask !== '') return ask;

  const subject = message.subject?.trim();
  if (subject !== undefined && subject !== '') return subject;

  const body = message.body.trim().replaceAll(/\s+/g, ' ');
  if (body === '') return 'No readable text — open it at the source.';
  return body.length <= ASK_FALLBACK_LENGTH ? body : `${body.slice(0, ASK_FALLBACK_LENGTH)}…`;
}
