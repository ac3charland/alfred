import { makeReaderPost } from './fixtures';
import { INSTAPAPER_UNCONFIGURED, NOTHING_TO_SEND, sendUnavailable } from './send';

const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

describe('sendUnavailable', () => {
  it('is available for a post with a web link, whatever became of its text', () => {
    const post = makeReaderPost(PUBLICATION_ID, {
      canonical_url: 'https://example.substack.com/p/a-post',
      word_count: 0,
      text_swept_at: '2026-09-08T03:00:00.000Z',
    });

    expect(sendUnavailable(post, true)).toBeUndefined();
  });

  it('is available for a link-less post that still holds its text — it goes as a private bookmark', () => {
    const post = makeReaderPost(PUBLICATION_ID, { canonical_url: null, word_count: 420 });

    expect(sendUnavailable(post, true)).toBeUndefined();
  });

  it.each([
    ['its text was swept', { word_count: 420, text_swept_at: '2026-09-08T03:00:00.000Z' }],
    ['it never had a body', { word_count: 0 }],
  ])('has nothing to send when there is no link and %s', (_name, overrides) => {
    const post = makeReaderPost(PUBLICATION_ID, { canonical_url: null, ...overrides });

    expect(sendUnavailable(post, true)).toBe(NOTHING_TO_SEND);
  });

  it('counts a javascript: or other non-web canonical URL as no link at all', () => {
    const post = makeReaderPost(PUBLICATION_ID, {
      canonical_url: 'javascript:alert(1)',
      word_count: 0,
    });

    expect(sendUnavailable(post, true)).toBe(NOTHING_TO_SEND);
  });

  it('says the deployment is not set up before anything about the post', () => {
    const post = makeReaderPost(PUBLICATION_ID, { canonical_url: null, word_count: 0 });

    expect(sendUnavailable(post, false)).toBe(INSTAPAPER_UNCONFIGURED);
  });

  it('words both reasons for the disabled verb’s title', () => {
    expect(INSTAPAPER_UNCONFIGURED).toBe("Instapaper isn't set up on this deployment.");
    expect(NOTHING_TO_SEND).toBe('No link and no stored text to send.');
  });
});
