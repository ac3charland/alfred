import { referenceIds, threadKeyFor } from './thread.ts';

describe('referenceIds', () => {
  it('keeps every id, angle brackets and all, when the header listed several', () => {
    expect(referenceIds(['<root@example.com>', '<mid@example.com>'])).toEqual([
      '<root@example.com>',
      '<mid@example.com>',
    ]);
  });

  it('wraps the single-id form mailparser hands back as a bare string', () => {
    expect(referenceIds('<root@example.com>')).toEqual(['<root@example.com>']);
  });

  it('is empty when the message carries no References header', () => {
    expect(referenceIds()).toEqual([]);
  });
});

describe('threadKeyFor', () => {
  it('uses the first id in References — the root of the conversation', () => {
    expect(
      threadKeyFor({
        references: ['<root@example.com>', '<mid@example.com>'],
        inReplyTo: '<mid@example.com>',
        messageId: '<reply@example.com>',
        fallback: '9:12',
      }),
    ).toBe('<root@example.com>');
  });

  it('falls back to In-Reply-To when a reply carries no References', () => {
    expect(
      threadKeyFor({
        references: [],
        inReplyTo: '<parent@example.com>',
        messageId: '<reply@example.com>',
        fallback: '9:12',
      }),
    ).toBe('<parent@example.com>');
  });

  it('uses the message own id when nothing points backwards — a root starts its thread', () => {
    expect(
      threadKeyFor({
        references: [],
        inReplyTo: undefined,
        messageId: '<root@example.com>',
        fallback: '9:12',
      }),
    ).toBe('<root@example.com>');
  });

  it('falls back to the mailbox identity when the message has no Message-ID at all', () => {
    expect(
      threadKeyFor({
        references: [],
        inReplyTo: undefined,
        messageId: undefined,
        fallback: '9:12',
      }),
    ).toBe('9:12');
  });
});
