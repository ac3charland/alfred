/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
// The node environment, not jsdom: this file exercises `fetch` and reads real `Response`
// objects, and jsdom has neither. The pragma has to be the file's FIRST docblock, which is why
// nothing — not even `jest.mock` — sits above the imports here: the lint autofix hoists imports
// to the top of the file, and anything it lifts over the pragma makes jest ignore it silently.
import {
  ADD_TIMEOUT_MS,
  type SendablePost,
  addBookmark,
  buildBookmarkParams,
  readAddResponse,
} from './bookmark';
import type { InstapaperConfig } from './config';

jest.mock('server-only', () => ({}));

const CONFIG: InstapaperConfig = {
  consumerKey: 'consumer-key',
  consumerSecret: 'consumer-secret',
  accessToken: 'access-token',
  accessTokenSecret: 'access-token-secret',
  apiUrl: 'https://www.instapaper.com',
};

function post(overrides: Partial<SendablePost> = {}): SendablePost {
  return {
    title: 'How near is the intelligence explosion, really?',
    canonical_url: 'https://open.substack.com/pub/harborline/p/the-grain-ledger',
    gist: 'Argues the recursive self-improvement debate conflates three feedback loops.',
    html: '<html><body><h1>How near</h1><p>Argues…</p></body></html>',
    text: 'How near\n\nArgues…',
    ...overrides,
  };
}

/** The request's parameters, named — every one the builder can emit is optional. */
interface BookmarkParams {
  url?: string;
  is_private_from_source?: string;
  title?: string;
  description?: string;
  content?: string;
}

/** The parameters as a lookup, for the cases that care about one value rather than the order. */
function asMap(parameters: [string, string][] | null): BookmarkParams {
  return Object.fromEntries(parameters ?? []);
}

describe('buildBookmarkParams — the content ladder', () => {
  it('sends the email HTML when there is some', () => {
    // The whole point of storing it: Instapaper parses what it is handed instead of fetching the
    // URL, so a paid post arrives in full rather than as the paywall's teaser.
    expect(asMap(buildBookmarkParams(post())).content).toBe(
      '<html><body><h1>How near</h1><p>Argues…</p></body></html>',
    );
  });

  it('falls back to the stored text as paragraphs when there is no HTML', () => {
    // Every post ingested before the Reader began keeping the markup takes this rung.
    expect(asMap(buildBookmarkParams(post({ html: null }))).content).toBe(
      '<p>How near</p>\n<p>Argues…</p>',
    );
  });

  it('treats whitespace-only HTML as none and takes the text rung', () => {
    expect(asMap(buildBookmarkParams(post({ html: '   \n ' }))).content).toBe(
      '<p>How near</p>\n<p>Argues…</p>',
    );
  });

  it('sends no content at all when the body is gone, leaving Instapaper to fetch the link', () => {
    // A swept post. The link is still an article Instapaper can reach on its own, so the send
    // is better than nothing — it just arrives as the public page.
    const parameters = asMap(buildBookmarkParams(post({ html: null, text: null })));
    expect(parameters.content).toBeUndefined();
    expect(parameters.url).toBe('https://open.substack.com/pub/harborline/p/the-grain-ledger');
  });
});

describe('buildBookmarkParams — the address', () => {
  it('sends an http(s) canonical URL as the url', () => {
    const parameters = asMap(buildBookmarkParams(post()));
    expect(parameters.url).toBe('https://open.substack.com/pub/harborline/p/the-grain-ledger');
    expect(parameters.is_private_from_source).toBeUndefined();
  });

  it('sends a link-less post as a private bookmark from source email', () => {
    const parameters = asMap(buildBookmarkParams(post({ canonical_url: null })));
    expect(parameters.is_private_from_source).toBe('email');
    expect(parameters.url).toBeUndefined();
    expect(parameters.content).not.toBe('');
  });

  it('never sends a javascript: or data: URL as the url', () => {
    // The column is extracted from mail nobody here wrote. Handing one of these to a service
    // that will fetch it is the same refusal the row's own link makes.
    for (const hostile of [
      'javascript:alert(1)',
      'data:text/html,<p>x</p>',
      'mailto:a@b.example',
    ]) {
      const parameters = asMap(buildBookmarkParams(post({ canonical_url: hostile })));
      expect(parameters.url).toBeUndefined();
      expect(parameters.is_private_from_source).toBe('email');
    }
  });

  it('never sends the Gmail permalink as the url', () => {
    // The row's "Original" link falls back to it, but Instapaper would save a login wall. A post
    // whose only address is the mailbox goes as a private bookmark instead.
    const parameters = asMap(
      buildBookmarkParams(post({ canonical_url: null, html: '<p>the post as it was mailed</p>' })),
    );
    expect(JSON.stringify(parameters)).not.toContain('mail.google.com');
    expect(parameters.is_private_from_source).toBe('email');
  });

  it('ignores surrounding whitespace on the stored URL', () => {
    expect(
      asMap(buildBookmarkParams(post({ canonical_url: '  https://example.com/p/x  ' }))).url,
    ).toBe('https://example.com/p/x');
  });
});

describe('buildBookmarkParams — the rest of the request', () => {
  it('always sends the post title', () => {
    // So Instapaper skips its own synchronous title lookup, and the list reads with the real
    // subject line rather than whatever the parser makes of the markup.
    expect(asMap(buildBookmarkParams(post())).title).toBe(
      'How near is the intelligence explosion, really?',
    );
  });

  it('sends the gist as the description only when there is one', () => {
    expect(asMap(buildBookmarkParams(post())).description).toBe(
      'Argues the recursive self-improvement debate conflates three feedback loops.',
    );
    expect(asMap(buildBookmarkParams(post({ gist: null }))).description).toBeUndefined();
    expect(asMap(buildBookmarkParams(post({ gist: '  ' }))).description).toBeUndefined();
  });

  it('sends no tag and no folder', () => {
    // A sent post lands in Unread like anything else the owner saves. An automatic tag would
    // either do nothing or send every post to the wiki, which is the tag-sync's own decision.
    const names = (buildBookmarkParams(post()) ?? []).map(([name]) => name);
    expect(names).not.toContain('tags');
    expect(names).not.toContain('folder_id');
    expect(names).not.toContain('resolve_final_url');
  });

  it('returns null when there is neither a link nor a body', () => {
    // No article and no address to find one at — the route refuses before any outbound call.
    expect(buildBookmarkParams(post({ canonical_url: null, html: null, text: null }))).toBeNull();
    expect(buildBookmarkParams(post({ canonical_url: null, html: '', text: '  ' }))).toBeNull();
  });
});

describe('readAddResponse', () => {
  it('reads a bookmark id out of the array Instapaper answers with', () => {
    expect(
      readAddResponse(200, [{ type: 'bookmark', bookmark_id: 1_234_567, title: 'x' }]),
    ).toEqual({ kind: 'saved', bookmarkId: 1_234_567 });
  });

  it.each([
    ['opted out', 1221],
    ['needs content', 1220],
    ['invalid URL', 1240],
    ['rate limited', 1040],
    ['premium required', 1041],
    ['suspended', 1042],
    ['unexpected', 1246],
  ])('reads the %s error code as a refusal', (_label, code) => {
    expect(
      readAddResponse(400, [{ type: 'error', error_code: code, message: 'internal' }]),
    ).toEqual({ kind: 'refused', code });
  });

  it('reads an HTTP 401 or 403 as a refusal carrying the status', () => {
    // These are about alfred's credentials rather than the post, and arrive with no useful body.
    expect(readAddResponse(401, [])).toEqual({ kind: 'refused', code: 401 });
    expect(readAddResponse(403, undefined)).toEqual({ kind: 'refused', code: 403 });
  });

  it('reads a body that is not the documented array as unavailable', () => {
    // Instapaper's docs say to treat a non-JSON body as a 503; an array of something
    // unrecognised is the same situation — nothing can be concluded about the post.
    expect(readAddResponse(200, '<html>maintenance</html>')).toEqual({ kind: 'unavailable' });
    expect(readAddResponse(200, { type: 'bookmark', bookmark_id: 1 })).toEqual({
      kind: 'unavailable',
    });
    expect(readAddResponse(200, [])).toEqual({ kind: 'unavailable' });
    expect(readAddResponse(200, [{ type: 'bookmark' }])).toEqual({ kind: 'unavailable' });
    expect(readAddResponse(500, [{ type: 'error' }])).toEqual({ kind: 'unavailable' });
  });
});

describe('addBookmark', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  /**
   * Capture the one request and answer it with `respond`. Its parameters are typed as the call
   * it actually receives, so the assertions below read the URL and the init object without
   * casting them back out of `any` — a cast there would hide a changed call shape rather than
   * fail on it.
   */
  function mockFetch(respond: () => Promise<Response> | Response) {
    const fetchMock = jest.fn(
      async (_url: string, _init: RequestInit): Promise<Response> => respond(),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('posts a signed, form-encoded request to bookmarks/add', async () => {
    const fetchMock = mockFetch(() =>
      Response.json([{ type: 'bookmark', bookmark_id: 42 }], { status: 200 }),
    );

    const parameters = buildBookmarkParams(post()) ?? [];
    await expect(addBookmark(CONFIG, parameters)).resolves.toEqual({
      kind: 'saved',
      bookmarkId: 42,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? ['', {}];
    expect(url).toBe('https://www.instapaper.com/api/1/bookmarks/add');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded; charset=utf-8');
    expect(headers['Authorization']).toMatch(/^OAuth /);
    expect(headers['Authorization']).toContain('oauth_signature=');
    // The body carries the article, which is the parameter the whole feature exists for.
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get('content')).toContain('<h1>How near</h1>');
    expect(sent.get('title')).toBe('How near is the intelligence explosion, really?');
  });

  it('signs the parameters it sends, so the body and the signature cannot drift', async () => {
    // Two sends of different posts must not produce the same signature, which is what a signer
    // handed the wrong parameter list would do.
    const signatures: string[] = [];
    const fetchMock = mockFetch(() => Response.json([{ type: 'bookmark', bookmark_id: 1 }]));

    for (const title of ['One', 'Two']) {
      await addBookmark(CONFIG, buildBookmarkParams(post({ title })) ?? []);
    }
    for (const [, init] of fetchMock.mock.calls) {
      const headers = init.headers as Record<string, string>;
      signatures.push(/oauth_signature="([^"]*)"/.exec(headers['Authorization'] ?? '')?.[1] ?? '');
    }
    expect(signatures[0]).not.toBe(signatures[1]);
  });

  it('reads the API origin from the config, so the E2E mock can stand in', async () => {
    const fetchMock = mockFetch(() => Response.json([{ type: 'bookmark', bookmark_id: 7 }]));
    await addBookmark({ ...CONFIG, apiUrl: 'http://localhost:54331' }, [['title', 'x']]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:54331/api/1/bookmarks/add');
  });

  it('aborts after the send timeout rather than leaving the owner waiting', async () => {
    const fetchMock = mockFetch(() => Response.json([{ type: 'bookmark', bookmark_id: 1 }]));
    await addBookmark(CONFIG, [['title', 'x']]);
    expect(fetchMock.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    expect(ADD_TIMEOUT_MS).toBe(15_000);
  });

  it('reports a refusal with its code', async () => {
    mockFetch(() => Response.json([{ type: 'error', error_code: 1221, message: 'internal' }]));
    await expect(addBookmark(CONFIG, [['title', 'x']])).resolves.toEqual({
      kind: 'refused',
      code: 1221,
    });
  });

  it('reports a thrown request — a timeout, a reset, a DNS failure — as unavailable', async () => {
    mockFetch(() => {
      throw new Error('The operation was aborted due to timeout');
    });
    await expect(addBookmark(CONFIG, [['title', 'x']])).resolves.toEqual({ kind: 'unavailable' });
  });

  it('reports a non-JSON body as unavailable', async () => {
    mockFetch(() => new Response('<html>maintenance</html>', { status: 503 }));
    await expect(addBookmark(CONFIG, [['title', 'x']])).resolves.toEqual({ kind: 'unavailable' });
  });
});
