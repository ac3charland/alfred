import { makeReaderPost } from '@/lib/reader/fixtures';

import { postOpenLink } from './open-link';

const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

describe('postOpenLink', () => {
  it('prefers the canonical URL', () => {
    const post = makeReaderPost(PUBLICATION_ID, {
      canonical_url: 'https://example.substack.com/p/a-post',
      rfc822_message_id: '<a-post@mail.substack.com>',
    });

    expect(postOpenLink(post)).toEqual({
      href: 'https://example.substack.com/p/a-post',
      kind: 'canonical',
      unavailable: undefined,
    });
  });

  it('falls back to the Gmail permalink, stripping angle brackets and URL-encoding', () => {
    const post = makeReaderPost(PUBLICATION_ID, {
      canonical_url: null,
      rfc822_message_id: '<import-ai-412@mail.substack.com>',
    });

    expect(postOpenLink(post)).toEqual({
      href: 'https://mail.google.com/mail/u/0/#search/rfc822msgid:import-ai-412%40mail.substack.com',
      kind: 'mailbox',
      unavailable: undefined,
    });
  });

  it('is unavailable, with a reason, when neither exists', () => {
    const post = makeReaderPost(PUBLICATION_ID, { canonical_url: null, rfc822_message_id: null });

    const link = postOpenLink(post);
    expect(link.href).toBeUndefined();
    expect(link.kind).toBeUndefined();
    expect(link.unavailable).toBe('No link in the post and no Message-ID captured for it.');
  });

  it('treats a blank canonical_url as absent and falls back', () => {
    const post = makeReaderPost(PUBLICATION_ID, {
      canonical_url: ' '.repeat(3),
      rfc822_message_id: '<fallback@mail.substack.com>',
    });

    expect(postOpenLink(post).kind).toBe('mailbox');
  });
});
