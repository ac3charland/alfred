import { isNewsletter } from './newsletter';

const noRoster = { senderHandle: 'news@sender.example', rosterHandles: new Set<string>() };

describe('isNewsletter', () => {
  it('filters on List-Unsubscribe', () => {
    expect(
      isNewsletter([{ name: 'List-Unsubscribe', value: '<https://x.example/u>' }], noRoster),
    ).toBe(true);
  });

  it('filters on List-ID, matched however the sender cased the header', () => {
    expect(isNewsletter([{ name: 'list-id', value: '<news.example>' }], noRoster)).toBe(true);
  });

  it('does not filter on a lone Precedence: bulk — ordinary automated mail sets it too', () => {
    expect(isNewsletter([{ name: 'Precedence', value: 'bulk' }], noRoster)).toBe(false);
  });

  it('never filters a sender on the roster — a priority person on a list is still one', () => {
    expect(
      isNewsletter([{ name: 'List-Unsubscribe', value: '<https://x.example/u>' }], {
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
});
