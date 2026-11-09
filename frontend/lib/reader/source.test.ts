import {
  makeReaderArticle,
  makeReaderFeed,
  makeReaderFeedPost,
  makeReaderPost,
  makeReaderPublication,
  makeResearchPost,
} from '@/lib/reader/fixtures';

import {
  INSTAPAPER_EYEBROW,
  RESEARCH_EYEBROW,
  VIA_INSTAPAPER,
  isFeedPost,
  isInstapaperPost,
  postEyebrow,
} from './source';

const WORKS_IN_PROGRESS = makeReaderPublication('Works in Progress');
const PUBLICATIONS = [makeReaderPublication('Second Thoughts'), WORKS_IN_PROGRESS];

describe('postEyebrow', () => {
  it('keeps a newsletter’s eyebrow as it was: its author, or the unknown-publication line', () => {
    const newsletter = makeReaderPost(PUBLICATIONS[0]?.id ?? null, { author: 'Import AI' });
    expect(postEyebrow(newsletter, PUBLICATIONS)).toBe('Import AI');
    expect(postEyebrow({ ...newsletter, author: null }, PUBLICATIONS)).toBe('Unknown publication');
  });

  it('names an article by its site', () => {
    expect(postEyebrow(makeReaderArticle({ site: 'worksinprogress.co' }), PUBLICATIONS)).toBe(
      'worksinprogress.co',
    );
  });

  it('names a linked article by its publication instead', () => {
    const linked = makeReaderArticle({ publication_id: WORKS_IN_PROGRESS.id });
    expect(postEyebrow(linked, PUBLICATIONS)).toBe('Works in Progress');
  });

  it('falls back to the site when the linked publication is not in the roster it was handed', () => {
    const linked = makeReaderArticle({ publication_id: WORKS_IN_PROGRESS.id, site: 'wip.co' });
    expect(postEyebrow(linked, [])).toBe('wip.co');
  });

  it('falls back to Instapaper for an article with neither', () => {
    expect(postEyebrow(makeReaderArticle({ site: null }), PUBLICATIONS)).toBe(INSTAPAPER_EYEBROW);
    expect(INSTAPAPER_EYEBROW).toBe('Instapaper');
  });
});

describe('postEyebrow for a feed post', () => {
  const FEED = makeReaderFeed('mlarson.org', 'https://mlarson.org/feed.xml');

  it('names the feed’s card, never the entry’s author', () => {
    const post = makeReaderFeedPost(FEED.id, { author: 'Mark Larson' });
    expect(postEyebrow(post, [...PUBLICATIONS, FEED])).toBe('mlarson.org');
  });

  it('falls back to the unknown-publication line when the feed is not in the roster', () => {
    expect(postEyebrow(makeReaderFeedPost(FEED.id), PUBLICATIONS)).toBe('Unknown publication');
  });

  it('is told from the other sources by its source alone', () => {
    expect(isFeedPost(makeReaderFeedPost(FEED.id))).toBe(true);
    expect(isFeedPost(makeReaderArticle())).toBe(false);
    expect(isInstapaperPost(makeReaderFeedPost(FEED.id))).toBe(false);
  });
});

describe('postEyebrow for a research post', () => {
  it('reads Research whatever phase the post is in, and never an author or a publication', () => {
    const publication = PUBLICATIONS[0];
    for (const overrides of [
      {},
      { research_state: 'done' as const, author: 'Claude Code research routine' },
      { research_state: 'failed' as const, publication_id: publication?.id ?? null },
    ]) {
      expect(postEyebrow(makeResearchPost(overrides), PUBLICATIONS)).toBe('Research');
    }
    expect(RESEARCH_EYEBROW).toBe('Research');
  });
});

describe('isInstapaperPost', () => {
  it('tells an article from a newsletter by its source', () => {
    expect(isInstapaperPost(makeReaderArticle())).toBe(true);
    expect(isInstapaperPost(makeReaderPost(null))).toBe(false);
    expect(VIA_INSTAPAPER).toBe('via Instapaper');
  });
});
