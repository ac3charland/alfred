/** @jest-environment node */
import {
  type BookmarkSource,
  INSTAPAPER_TIMEOUT_MS,
  addBookmark,
  bookmarkFailure,
  buildBookmarkParams,
  readBookmarkResponse,
} from './bookmark';
import type { InstapaperConfig } from './config';

jest.mock('server-only', () => ({}));

const POST: BookmarkSource = {
  title: 'How near is the intelligence explosion, really?',
  canonical_url: 'https://open.substack.com/pub/secondthoughts/p/how-near',
  gist: 'Argues the RSI debate conflates three feedback loops.',
  html: '<html><body><p>The whole post.</p></body></html>',
  text: 'The whole post.',
};

const CONFIG: InstapaperConfig = {
  consumerKey: 'ck',
  consumerSecret: 'cs',
  accessToken: 'at',
  accessTokenSecret: 'ats',
  apiUrl: 'https://instapaper.test',
};

describe('buildBookmarkParams', () => {
  it('sends the link, the title, the gist as description and the email HTML as content', () => {
    expect(buildBookmarkParams(POST)).toStrictEqual({
      url: 'https://open.substack.com/pub/secondthoughts/p/how-near',
      title: POST.title,
      description: POST.gist,
      content: POST.html,
    });
  });

  it('falls back to the stored text as escaped paragraphs when there is no HTML', () => {
    const params = buildBookmarkParams({ ...POST, html: null, text: 'One & two.\n\nThree.' });
    expect(params?.['content']).toBe('<p>One &amp; two.</p>\n<p>Three.</p>');
  });

  it('omits content when neither body exists, and lets Instapaper fetch the link', () => {
    const params = buildBookmarkParams({ ...POST, html: null, text: null });
    expect(params).toStrictEqual({
      url: POST.canonical_url,
      title: POST.title,
      description: POST.gist,
    });
  });

  it('treats an empty stored text as no body', () => {
    expect(buildBookmarkParams({ ...POST, html: null, text: '  ' })).not.toHaveProperty('content');
  });

  it('sends a link-less post with a body as a private bookmark, with no url', () => {
    const params = buildBookmarkParams({ ...POST, canonical_url: null });
    expect(params).toStrictEqual({
      is_private_from_source: 'email',
      title: POST.title,
      description: POST.gist,
      content: POST.html,
    });
  });

  it.each([
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a Gmail permalink-shaped non-web value', 'mailto:someone@example.com'],
    ['garbage', 'not a url'],
  ])('never sends %s as the url', (_label, canonical) => {
    const params = buildBookmarkParams({ ...POST, canonical_url: canonical });
    expect(params).not.toHaveProperty('url');
    expect(params?.['is_private_from_source']).toBe('email');
  });

  it('is null when there is no link and no body — nothing to send', () => {
    expect(
      buildBookmarkParams({ ...POST, canonical_url: null, html: null, text: null }),
    ).toBeNull();
    expect(buildBookmarkParams({ ...POST, canonical_url: null, html: null, text: '' })).toBeNull();
  });

  it('carries a description only when there is a gist', () => {
    expect(buildBookmarkParams({ ...POST, gist: null })).not.toHaveProperty('description');
  });

  it('never sets tags or a folder', () => {
    const params = buildBookmarkParams(POST) ?? {};
    expect(Object.keys(params)).not.toContain('tags');
    expect(Object.keys(params)).not.toContain('folder_id');
  });
});

describe('readBookmarkResponse', () => {
  it('reads a saved bookmark’s id', () => {
    expect(readBookmarkResponse(200, '[{"type":"bookmark","bookmark_id":1234567}]')).toEqual({
      kind: 'saved',
      bookmarkId: 1_234_567,
    });
  });

  it('reads an error’s code, whatever the HTTP status', () => {
    const body = '[{"type":"error","error_code":1221,"message":"Publisher opted out"}]';
    expect(readBookmarkResponse(400, body)).toEqual({ kind: 'refused', code: 1221 });
  });

  it('reads a bare 401/403 as rejected credentials', () => {
    expect(readBookmarkResponse(401, 'Unauthorized')).toEqual({
      kind: 'refused',
      code: 'unauthorized',
    });
    expect(readBookmarkResponse(403, '')).toEqual({ kind: 'refused', code: 'unauthorized' });
  });

  it('reads a non-JSON body, a 5xx or an empty array as no answer', () => {
    expect(readBookmarkResponse(200, '<html>oops</html>')).toEqual({ kind: 'unavailable' });
    expect(readBookmarkResponse(503, '')).toEqual({ kind: 'unavailable' });
    expect(readBookmarkResponse(200, '[]')).toEqual({ kind: 'unavailable' });
  });
});

describe('bookmarkFailure — what the route answers', () => {
  it.each([
    [1221, 422, 'This publication has opted out of Instapaper'],
    [1220, 422, "Instapaper can't fetch this post itself, and its stored text is gone"],
    [1240, 422, "Instapaper didn't accept this post's link"],
    [1040, 429, 'Instapaper is rate-limiting — try again in a minute'],
    [1042, 502, "Instapaper rejected alfred's credentials"],
    ['unauthorized', 502, "Instapaper rejected alfred's credentials"],
    [1041, 502, 'Instapaper says this needs a Premium account'],
    [1246, 502, "Instapaper didn't answer — try again"],
    [1500, 502, "Instapaper didn't answer — try again"],
  ] as const)('refused %s → %i', (code, status, detail) => {
    expect(bookmarkFailure({ kind: 'refused', code })).toEqual({ status, detail });
  });

  it('answers 502 for no answer at all', () => {
    expect(bookmarkFailure({ kind: 'unavailable' })).toEqual({
      status: 502,
      detail: "Instapaper didn't answer — try again",
    });
  });
});

describe('addBookmark', () => {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs the params form-encoded, signed, to bookmarks/add with a 15 s abort', async () => {
    fetchMock.mockResolvedValue(new Response('[{"type":"bookmark","bookmark_id":42}]'));
    const timeout = jest.spyOn(AbortSignal, 'timeout');

    const outcome = await addBookmark(CONFIG, { url: 'https://x.test/p', title: 'T & U' });

    expect(outcome).toEqual({ kind: 'saved', bookmarkId: 42 });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://instapaper.test/api/1/bookmarks/add');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('url=https%3A%2F%2Fx.test%2Fp&title=T+%26+U');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded; charset=utf-8');
    expect(headers['Authorization']).toMatch(/^OAuth .*oauth_token="at"/);
    expect(timeout).toHaveBeenCalledWith(INSTAPAPER_TIMEOUT_MS);
    expect(INSTAPAPER_TIMEOUT_MS).toBe(15_000);
  });

  it('reports a refusal', async () => {
    fetchMock.mockResolvedValue(
      new Response('[{"type":"error","error_code":1040,"message":"Rate-limit exceeded"}]', {
        status: 400,
      }),
    );

    await expect(addBookmark(CONFIG, { title: 'T' })).resolves.toEqual({
      kind: 'refused',
      code: 1040,
    });
  });

  it('reports a timeout or network error as unavailable, never throwing', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    await expect(addBookmark(CONFIG, { title: 'T' })).resolves.toEqual({ kind: 'unavailable' });

    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(addBookmark(CONFIG, { title: 'T' })).resolves.toEqual({ kind: 'unavailable' });
  });

  it('reports a non-JSON body as unavailable', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Service Unavailable</html>'));
    await expect(addBookmark(CONFIG, { title: 'T' })).resolves.toEqual({ kind: 'unavailable' });
  });
});
