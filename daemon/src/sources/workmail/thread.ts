/**
 * Which conversation a message belongs to.
 *
 * IMAP has no thread id — the THREAD extension is optional and WorkMail does not offer one — so
 * the conversation has to be reconstructed from the reply headers every mail client already
 * writes. The root of the References chain is the best available answer: every reply in a thread
 * carries the same first id, so replies group with the message that started them without the
 * server being asked anything.
 *
 * Ids keep their angle brackets, exactly as the headers spell them, so a key produced here can be
 * compared against a Message-ID from any other part of the system without a normalization step
 * that both sides have to agree on.
 */

export interface ThreadInput {
  references: readonly string[];
  inReplyTo: string | undefined;
  messageId: string | undefined;
  /** Used when the message carries no ids at all — the mailbox coordinates, `uidvalidity:uid`. */
  fallback: string;
}

/** mailparser hands back a bare string when the header listed one id, an array when it listed several. */
export function referenceIds(value?: readonly string[] | string): string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : [...value];
}

export function threadKeyFor(input: ThreadInput): string {
  // A root message starts its own thread: its replies will name it in References, so keying it on
  // its own Message-ID puts the whole conversation under one key from the first message onwards.
  return input.references[0] ?? input.inReplyTo ?? input.messageId ?? input.fallback;
}
