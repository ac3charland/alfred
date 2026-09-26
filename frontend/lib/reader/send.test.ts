import { makeReaderPost } from '@/lib/reader/fixtures';

import { NOTHING_TO_SEND, NOT_CONFIGURED, sendUnavailable } from './send';

const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

function post(overrides: Parameters<typeof makeReaderPost>[1] = {}) {
  return makeReaderPost(PUBLICATION_ID, {
    canonical_url: 'https://example.test/p/a',
    word_count: 900,
    ...overrides,
  });
}

describe('sendUnavailable', () => {
  it('is available for a post with a link and a body', () => {
    expect(sendUnavailable(post(), true)).toBeUndefined();
  });

  it('says the deployment has no Instapaper before anything about the post', () => {
    expect(sendUnavailable(post({ canonical_url: null, word_count: 0 }), false)).toBe(
      NOT_CONFIGURED,
    );
    expect(NOT_CONFIGURED).toBe("Instapaper isn't set up on this deployment.");
  });

  it('is available with a link alone — Instapaper fetches it', () => {
    expect(sendUnavailable(post({ word_count: 0 }), true)).toBeUndefined();
    expect(sendUnavailable(post({ text_swept_at: '2026-09-08T03:00:00.000Z' }), true)).toBe(
      undefined,
    );
  });

  it('is available with a body alone — it goes as a private bookmark', () => {
    expect(sendUnavailable(post({ canonical_url: null }), true)).toBeUndefined();
  });

  it.each([
    ['no link at all', { canonical_url: null }],
    ['a link that is not a web address', { canonical_url: 'mailto:someone@example.com' }],
  ])('is unavailable with %s and no stored text', (_label, link) => {
    expect(sendUnavailable(post({ ...link, word_count: 0 }), true)).toBe(NOTHING_TO_SEND);
    expect(
      sendUnavailable(post({ ...link, text_swept_at: '2026-09-08T03:00:00.000Z' }), true),
    ).toBe(NOTHING_TO_SEND);
    expect(NOTHING_TO_SEND).toBe('No link and no stored text to send.');
  });
});
