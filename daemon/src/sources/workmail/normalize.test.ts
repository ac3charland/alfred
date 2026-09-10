import type { ExtractedMessage } from './mime.ts';
import { normalizeMessage } from './normalize.ts';
import type { NormalizeInput } from './normalize.ts';

/**
 * `received_at` is what the retention sweep (`comm_sweep_expired`, `where received_at < now() -
 * 60 days`) keys off. A sender-controlled `Date:` header must never be able to steer it — see the
 * Gmail source's `receivedAt()` in `workers/src/comms/gmail.ts`, which prefers the platform's own
 * receipt timestamp over anything a header claims, and this module matches that policy.
 */

const NOW = new Date('2025-09-08T18:00:00.000Z');
const INTERNAL_DATE = new Date('2025-09-05T10:00:00.000Z');

function extracted(overrides: Partial<ExtractedMessage> = {}): ExtractedMessage {
  return {
    messageId: '<msg-1@example.com>',
    inReplyTo: undefined,
    references: [],
    subject: 'Subject',
    fromAddress: 'ada@example.com',
    fromName: undefined,
    participants: [],
    body: 'Body',
    date: undefined,
    hasAttachments: false,
    listHeaders: [],
    ...overrides,
  };
}

function input(overrides: Partial<NormalizeInput> = {}): NormalizeInput {
  return {
    extracted: extracted(),
    uid: 12,
    uidvalidity: 77,
    internalDate: INTERNAL_DATE,
    direction: 'inbound',
    now: NOW,
    ...overrides,
  };
}

describe('normalizeMessage — received_at', () => {
  it('prefers the IMAP server own INTERNALDATE over a Date header that disagrees with it', () => {
    const message = normalizeMessage(
      input({
        internalDate: INTERNAL_DATE,
        extracted: extracted({ date: new Date('2025-09-06T00:00:00.000Z') }),
      }),
    );

    expect(message.received_at).toBe(INTERNAL_DATE.toISOString());
  });

  it('clamps a sender-forged future Date header to now rather than storing it verbatim', () => {
    // Nothing about INTERNALDATE — the case where the header is all that is left, and the
    // sender wrote `Date: Thu, 01 Jan 2099`. Storing it verbatim would put the row beyond the
    // reach of `comm_sweep_expired`'s `received_at < now() - 60 days` forever.
    const message = normalizeMessage(
      input({
        internalDate: undefined,
        extracted: extracted({ date: new Date('2099-01-01T00:00:00.000Z') }),
      }),
    );

    expect(message.received_at).toBe(NOW.toISOString());
  });

  it('falls back to the Date header only when INTERNALDATE is unavailable', () => {
    const headerDate = new Date('2025-09-06T00:00:00.000Z');
    const message = normalizeMessage(
      input({ internalDate: undefined, extracted: extracted({ date: headerDate }) }),
    );

    expect(message.received_at).toBe(headerDate.toISOString());
  });

  it('falls back to now when neither INTERNALDATE nor a header date is available', () => {
    const message = normalizeMessage(
      input({ internalDate: undefined, extracted: extracted({ date: undefined }) }),
    );

    expect(message.received_at).toBe(NOW.toISOString());
  });

  it('falls back to now when the message could not be parsed at all', () => {
    const message = normalizeMessage(input({ internalDate: undefined, extracted: undefined }));

    expect(message.received_at).toBe(NOW.toISOString());
  });

  it('clamps a forged future INTERNALDATE too, not just a forged header', () => {
    // INTERNALDATE is the server's own field and not sender-controlled, but a skewed clock is
    // still worth guarding: nothing this source emits should ever claim to be from the future.
    const message = normalizeMessage(input({ internalDate: new Date('2099-01-01T00:00:00.000Z') }));

    expect(message.received_at).toBe(NOW.toISOString());
  });
});
