import { makeReaderArticle, makeReaderPost, makeResearchPost } from '@/lib/reader/fixtures';
import { postEyebrow } from '@/lib/reader/source';

import { readerCaptureNotes } from './capture';

const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

describe('readerCaptureNotes', () => {
  it('names the post and its eyebrow on the first line and the link on the second', () => {
    expect(
      readerCaptureNotes(
        { title: 'Import AI 412: the eval that wouldn’t transfer' },
        'Import AI',
        'https://importai.substack.com/p/import-ai-412',
      ),
    ).toBe(
      'From the Reader: “Import AI 412: the eval that wouldn’t transfer” — Import AI\n' +
        'https://importai.substack.com/p/import-ai-412',
    );
  });

  it('is a single line when the post has nowhere to link to', () => {
    expect(readerCaptureNotes({ title: 'A post' }, 'Some Substack', undefined)).toBe(
      'From the Reader: “A post” — Some Substack',
    );
  });

  it('reads right for a newsletter, an Instapaper article and a research report', () => {
    const newsletter = makeReaderPost(PUBLICATION_ID, { title: 'N', author: 'Stratechery' });
    const instapaper = makeReaderArticle({ title: 'I', site: 'The Atlantic' });
    const research = makeResearchPost({ title: 'R' });

    expect(readerCaptureNotes(newsletter, postEyebrow(newsletter, []), undefined)).toBe(
      'From the Reader: “N” — Stratechery',
    );
    expect(readerCaptureNotes(instapaper, postEyebrow(instapaper, []), undefined)).toBe(
      'From the Reader: “I” — The Atlantic',
    );
    expect(readerCaptureNotes(research, postEyebrow(research, []), undefined)).toBe(
      'From the Reader: “R” — Research',
    );
  });
});
