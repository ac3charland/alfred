import { hasListHeaderSignal, isNewsletter } from './newsletter';

const noRoster = { senderHandle: 'news@sender.example', rosterHandles: new Set<string>() };

/** A list header plus, optionally, a subject — since the filter now needs both to fire. */
function bulkHeaders(subject?: string): { name: string; value: string }[] {
  const headers = [{ name: 'List-Unsubscribe', value: '<https://x.example/u>' }];
  return subject === undefined ? headers : [...headers, { name: 'Subject', value: subject }];
}

describe('isNewsletter', () => {
  it('filters on List-Unsubscribe when the subject reads as ordinary bulk mail', () => {
    expect(isNewsletter(bulkHeaders('Your weekly digest is here'), noRoster)).toBe(true);
  });

  it('filters on List-ID, matched however the sender cased the header, given a bulk-looking subject', () => {
    expect(
      isNewsletter(
        [
          { name: 'list-id', value: '<news.example>' },
          { name: 'Subject', value: 'This week in gardening' },
        ],
        noRoster,
      ),
    ).toBe(true);
  });

  it('does not filter on a lone Precedence: bulk — ordinary automated mail sets it too', () => {
    expect(isNewsletter([{ name: 'Precedence', value: 'bulk' }], noRoster)).toBe(false);
  });

  it('never filters a sender on the roster — a priority person on a list is still one', () => {
    expect(
      isNewsletter(bulkHeaders('Weekly roundup'), {
        senderHandle: 'Dana@Example.com',
        rosterHandles: new Set(['dana@example.com']),
      }),
    ).toBe(false);
  });

  it('does not filter ordinary mail', () => {
    expect(isNewsletter([{ name: 'From', value: 'dana@example.com' }], noRoster)).toBe(false);
    expect(isNewsletter(undefined, noRoster)).toBe(false);
  });

  it('reads an empty list header as no signal at all', () => {
    expect(isNewsletter([{ name: 'List-ID', value: '  ' }], noRoster)).toBe(false);
  });

  it('is case-insensitive when reading the subject for ask-language', () => {
    expect(isNewsletter(bulkHeaders('ACTION REQUIRED: verify your email'), noRoster)).toBe(false);
  });

  // BUG 1 regression coverage: a real obligation whose sender also happens to set a list header
  // (ordinary transactional/automated mail routinely does) must reach the classifier, never the
  // unbadged shelf, however these headers read.
  describe('a genuine obligation carrying a list header', () => {
    it.each([
      ['a password-reset alert', 'Reset your password'],
      ['a billing failure', 'Action required: your payment failed'],
      ['a security alert', 'New sign-in to your account'],
      ['an overdue invoice', 'Invoice #4471 is overdue'],
      ['a verification prompt', 'Please confirm your email address'],
    ])('is not filtered: %s', (_label, subject) => {
      expect(isNewsletter(bulkHeaders(subject), noRoster)).toBe(false);
    });
  });

  it('fails safe when no subject reached the filter at all: never shelves on the header alone', () => {
    // No `Subject` header in this message's own headers — e.g. the daemon-sourced ingest path,
    // which synthesizes a headers array from list-header names only (see ingest.ts). Absence of a
    // checkable subject must never be read as evidence the message is safe to shelve.
    expect(
      isNewsletter([{ name: 'List-Unsubscribe', value: '<https://x.example/u>' }], noRoster),
    ).toBe(false);
  });
});

describe('hasListHeaderSignal', () => {
  it('is true for List-Unsubscribe', () => {
    expect(
      hasListHeaderSignal([{ name: 'List-Unsubscribe', value: '<https://x.example/u>' }]),
    ).toBe(true);
  });

  it('is true for List-ID, matched however the sender cased the header', () => {
    expect(hasListHeaderSignal([{ name: 'list-id', value: '<news.example>' }])).toBe(true);
  });

  it('is false with neither header present, or no headers at all', () => {
    expect(hasListHeaderSignal([{ name: 'From', value: 'dana@example.com' }])).toBe(false);
    // A variable rather than a literal `undefined` argument — the missing-headers case this
    // exercises is a real, reachable call shape (a message with no headers at all), not a
    // superfluous one an autofixer should collapse away.
    const missing = undefined;
    expect(hasListHeaderSignal(missing)).toBe(false);
  });

  it('does not consult the roster or the subject at all — pure header presence', () => {
    // Unlike isNewsletter, this is the raw signal for the classifier to weigh, not a shelving
    // decision — so it says nothing about who sent it or what the subject reads like.
    expect(hasListHeaderSignal(bulkHeaders('Reset your password'))).toBe(true);
  });
});
