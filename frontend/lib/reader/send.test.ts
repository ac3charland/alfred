import { makeReaderArticle, makeReaderPost, makeResearchPost } from '@/lib/reader/fixtures';

import { NOTHING_TO_SEND, NOT_CONFIGURED, REPORT_NOT_ARRIVED, sendUnavailable } from './send';

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

  it('is available for an Instapaper article whenever the deployment is configured', () => {
    // Its send moves the owner's own bookmark back to Unread, so neither a link nor a body has
    // to be in hand.
    const article = makeReaderArticle({ canonical_url: null, word_count: 0 });
    expect(sendUnavailable(article, true)).toBeUndefined();
    expect(sendUnavailable(article, false)).toBe(NOT_CONFIGURED);
  });
});

describe('sendUnavailable for a research post', () => {
  it.each(['queued', 'researching', 'failed'] as const)(
    'waits for the report while the post is %s',
    (research_state) => {
      expect(sendUnavailable(makeResearchPost({ research_state }), true)).toBe(REPORT_NOT_ARRIVED);
    },
  );

  it('says exactly that the report has not arrived', () => {
    expect(REPORT_NOT_ARRIVED).toBe("The report hasn't arrived yet.");
  });

  it('still says the deployment has no Instapaper first', () => {
    expect(sendUnavailable(makeResearchPost({ research_state: 'researching' }), false)).toBe(
      NOT_CONFIGURED,
    );
  });

  it('is available once the report is delivered — it has a body and needs no link', () => {
    const delivered = makeResearchPost({ research_state: 'done', word_count: 2400 });
    expect(delivered.canonical_url).toBeNull();
    expect(sendUnavailable(delivered, true)).toBeUndefined();
  });

  it('reads a swept report as having nothing to send', () => {
    const swept = makeResearchPost({
      research_state: 'done',
      word_count: 2400,
      text_swept_at: '2026-12-29T03:00:00.000Z',
    });
    expect(sendUnavailable(swept, true)).toBe(NOTHING_TO_SEND);
  });
});
