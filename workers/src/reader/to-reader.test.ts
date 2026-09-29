import { spyOnFetch } from '../fetch-stub';
import { InstapaperError } from '../instapaper/client';
import type { InstapaperApi, InstapaperBookmark } from '../instapaper/types';
import {
  INSTAPAPER_PUBLICATION,
  NO_FOLDER_ERROR,
  articlePublication,
  articleText,
  articleTitle,
  articleUrl,
  instapaperFailureWords,
  listToReader,
  planBookmark,
  siteOf,
  takeOldest,
} from './to-reader';

function bookmark(overrides: Partial<InstapaperBookmark> = {}): InstapaperBookmark {
  return {
    bookmarkId: 1,
    url: 'https://worksinprogress.co/issue/quiet-cities',
    title: 'Cities Are Getting Quieter',
    time: 1_789_000_000,
    ...overrides,
  };
}

/** Every fake call a test did not replace. */
function unexpected(): Promise<never> {
  return Promise.reject(new Error('unexpected Instapaper call'));
}

/** An `InstapaperApi` whose every call fails unless a test replaces it. */
function fakeApi(overrides: Partial<InstapaperApi> = {}): InstapaperApi {
  return {
    listFolders: unexpected,
    listBookmarks: unexpected,
    getText: unexpected,
    archive: unexpected,
    ...overrides,
  };
}

describe('siteOf', () => {
  it.each([
    ['https://www.Example.com/a/b?c=d', 'example.com'],
    ['https://WORKSINPROGRESS.CO/issue', 'worksinprogress.co'],
    ['https://blog.example.org/post', 'blog.example.org'],
    ['https://wwwx.example.com/', 'wwwx.example.com'],
    ['https://open.substack.com/pub/harborline/p/the-grain-ledger', 'harborline.substack.com'],
    ['https://open.substack.com/pub/Harborline/p/x?r=abc', 'harborline.substack.com'],
    ['https://open.substack.com/home', 'open.substack.com'],
  ])('reads %s as %s', (url, site) => {
    expect(siteOf(url)).toBe(site);
  });

  it.each([
    ['a mailto link', 'mailto:someone@example.com'],
    ['a javascript link', 'javascript:alert(1)'],
    ['a private emailed bookmark', ''],
    ['something that is not a URL', 'not a url'],
    ['no URL at all', undefined],
  ])('has no site for %s', (_label, url) => {
    expect(siteOf(url)).toBeUndefined();
  });
});

describe('articleUrl', () => {
  it('keeps an http(s) URL, trimmed', () => {
    expect(articleUrl(' https://example.com/a ')).toBe('https://example.com/a');
  });

  it.each(['', 'mailto:x@example.com', 'javascript:alert(1)', 'nope'])('drops %p', (url) => {
    expect(articleUrl(url)).toBeUndefined();
  });
});

describe('articleTitle', () => {
  it('is the bookmark’s title, collapsed', () => {
    expect(articleTitle('  Cities   Are Getting\nQuieter ', 'example.com')).toBe(
      'Cities Are Getting Quieter',
    );
  });

  it('falls back to the site, then to Untitled', () => {
    expect(articleTitle(' '.repeat(3), 'example.com')).toBe('example.com');
    expect(articleTitle('')).toBe('Untitled');
  });
});

describe('articleText', () => {
  it('strips Instapaper’s HTML to text and counts its words', () => {
    expect(articleText('<h1>A title</h1><p>Three short words.</p><script>x()</script>')).toEqual({
      text: 'A title\nThree short words.',
      word_count: 5,
    });
  });

  it('reads an empty page as no text at all', () => {
    expect(articleText('<p>   </p>')).toEqual({ text: '', word_count: 0 });
  });

  it('cuts the stored text at the ceiling', () => {
    const { text } = articleText(`<p>${'word '.repeat(100_000)}</p>`);
    expect(text.length).toBeLessThanOrEqual(400_000);
  });
});

describe('takeOldest', () => {
  it('takes the oldest bookmarks first, only as many as there are slots', () => {
    const marks = [
      bookmark({ bookmarkId: 3, time: 30 }),
      bookmark({ bookmarkId: 1, time: 10 }),
      bookmark({ bookmarkId: 2, time: 20 }),
    ];
    expect(takeOldest(marks, 2).map((mark) => mark.bookmarkId)).toEqual([1, 2]);
    expect(takeOldest(marks, 0)).toEqual([]);
  });

  it('breaks a tie on the bookmark id, so a tick is repeatable', () => {
    const marks = [bookmark({ bookmarkId: 9, time: 10 }), bookmark({ bookmarkId: 4, time: 10 })];
    expect(takeOldest(marks, 2).map((mark) => mark.bookmarkId)).toEqual([4, 9]);
  });
});

describe('planBookmark', () => {
  it('leaves a bookmark in To Reader on a capped day, whatever else is true', () => {
    expect(planBookmark(undefined, true)).toEqual({ kind: 'leave' });
    expect(planBookmark({ id: 'p', archived: true, bookmarkId: 1 }, true)).toEqual({
      kind: 'leave',
    });
  });

  it('restores an archived post that already holds the bookmark, then archives the bookmark', () => {
    expect(planBookmark({ id: 'post-1', archived: true, bookmarkId: 1 }, false)).toEqual({
      kind: 'restore',
      postId: 'post-1',
    });
  });

  it('only archives the bookmark when its post is already on the list', () => {
    expect(planBookmark({ id: 'post-1', archived: false, bookmarkId: 1 }, false)).toEqual({
      kind: 'archive',
    });
  });

  it('takes a bookmark no post holds into the Reader', () => {
    expect(planBookmark(undefined, false)).toEqual({ kind: 'intake' });
  });
});

describe('articlePublication', () => {
  const roster = new Map([['pub-wip', 'Works in Progress']]);

  it('prefers the linked publication’s name', () => {
    expect(articlePublication('pub-wip', 'worksinprogress.co', roster)).toBe('Works in Progress');
  });

  it('falls back to the site, then to Instapaper', () => {
    expect(articlePublication(undefined, 'worksinprogress.co', roster)).toBe('worksinprogress.co');
    expect(articlePublication('pub-gone', 'worksinprogress.co', roster)).toBe('worksinprogress.co');
    expect(articlePublication(undefined, undefined, roster)).toBe(INSTAPAPER_PUBLICATION);
  });
});

describe('instapaperFailureWords', () => {
  it.each([
    ['credentials', "Instapaper rejected alfred's credentials"],
    ['premium', 'Instapaper says this needs a Premium account'],
    ['rate-limited', 'Instapaper is rate-limiting alfred'],
    ['unavailable', "Instapaper didn't answer"],
  ] as const)('words a %s failure for the owner', (kind, words) => {
    expect(instapaperFailureWords(new InstapaperError('bookmarks/list', kind, 1040))).toBe(words);
  });

  it('never quotes a thrown value it does not recognise', () => {
    expect(instapaperFailureWords(new Error('secret-ish detail'))).toBe("Instapaper didn't answer");
  });
});

describe('listToReader', () => {
  it('finds the folder by its exact title and lists the oldest bookmarks the slots allow', async () => {
    const listBookmarks = jest
      .fn<Promise<InstapaperBookmark[]>, [number]>()
      .mockResolvedValue([
        bookmark({ bookmarkId: 2, time: 20 }),
        bookmark({ bookmarkId: 1, time: 10 }),
        bookmark({ bookmarkId: 3, time: 30 }),
      ]);
    const api = fakeApi({
      listFolders: () =>
        Promise.resolve([
          { folderId: 5, title: 'to reader' },
          { folderId: 6, title: 'To Reader' },
          { folderId: 7, title: 'To Wiki' },
        ]),
      listBookmarks,
    });

    const listed = await listToReader(api, 2);

    expect(listBookmarks).toHaveBeenCalledWith(6);
    expect(listed).toEqual({
      kind: 'listed',
      listed: 3,
      marks: [bookmark({ bookmarkId: 1, time: 10 }), bookmark({ bookmarkId: 2, time: 20 })],
    });
  });

  it('reports a missing folder rather than creating one', async () => {
    const api = fakeApi({
      listFolders: () => Promise.resolve([{ folderId: 7, title: 'To Wiki' }]),
    });
    await expect(listToReader(api, 6)).resolves.toEqual({ kind: 'no-folder' });
    expect(NO_FOLDER_ERROR).toBe('there is no “To Reader” folder in Instapaper');
  });

  it('lets an Instapaper failure through to the tick that stamps it', async () => {
    const api = fakeApi({
      listFolders: () => Promise.reject(new InstapaperError('folders/list', 'credentials')),
    });
    await expect(listToReader(api, 6)).rejects.toBeInstanceOf(InstapaperError);
    expect(spyOnFetch()).not.toHaveBeenCalled();
  });
});
