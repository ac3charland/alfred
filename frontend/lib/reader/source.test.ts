import { makeReaderArticle, makeReaderPost, makeReaderPublication } from '@/lib/reader/fixtures';

import { INSTAPAPER_EYEBROW, VIA_INSTAPAPER, isInstapaperPost, postEyebrow } from './source';

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

describe('isInstapaperPost', () => {
  it('tells an article from a newsletter by its source', () => {
    expect(isInstapaperPost(makeReaderArticle())).toBe(true);
    expect(isInstapaperPost(makeReaderPost(null))).toBe(false);
    expect(VIA_INSTAPAPER).toBe('via Instapaper');
  });
});
