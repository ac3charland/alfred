/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  type AddBookmarkOutcome,
  type BookmarkSource,
  addBookmark,
  buildBookmarkParams,
  sendFailureResponse,
} from './bookmark';
import type { InstapaperConfig } from './config';

jest.mock('server-only', () => ({}));

const CONFIG: InstapaperConfig = {
  apiUrl: 'https://www.instapaper.com',
  credentials: { consumerKey: 'ck', consumerSecret: 'cs', token: 'tk', tokenSecret: 'ts' },
};

const LINKED: BookmarkSource = {
  title: 'How near is the intelligence explosion, really?',
  canonical_url: 'https://open.substack.com/pub/second/p/how-near',
  gist: 'Argues the debate conflates three feedback loops.',
  html: '<html><body><p>The post, whole.</p></body></html>',
  text: 'The post, whole.',
};

describe('buildBookmarkParams', () => {
  it('sends the link, the title, the gist as description and the email HTML as content', () => {
    expect(buildBookmarkParams(LINKED)).toEqual({
      url: 'https://open.substack.com/pub/second/p/how-near',
      title: 'How near is the intelligence explosion, really?',
      description: 'Argues the debate conflates three feedback loops.',
      content: '<html><body><p>The post, whole.</p></body></html>',
    });
  });

  it('falls back to the stored text as paragraphs when there is no HTML', () => {
    const params = buildBookmarkParams({ ...LINKED, html: null, text: 'One.\nTwo & three.' });
    expect(params?.['content']).toBe('<p>One.</p>\n<p>Two &amp; three.</p>');
  });

  it('sends no body at all when neither is left, and lets Instapaper fetch the link', () => {
    const params = buildBookmarkParams({ ...LINKED, html: null, text: null });
    expect(params).toEqual({
      url: 'https://open.substack.com/pub/second/p/how-near',
      title: 'How near is the intelligence explosion, really?',
      description: 'Argues the debate conflates three feedback loops.',
    });
  });

  it('treats blank HTML and blank text as no body', () => {
    const params = buildBookmarkParams({ ...LINKED, html: '  ', text: '\n \n' });
    expect(params).not.toHaveProperty('content');
  });

  it('sends a post with no web link as a private bookmark from email, with its body', () => {
    const params = buildBookmarkParams({ ...LINKED, canonical_url: null });
    expect(params).toEqual({
      is_private_from_source: 'email',
      title: 'How near is the intelligence explosion, really?',
      description: 'Argues the debate conflates three feedback loops.',
      content: '<html><body><p>The post, whole.</p></body></html>',
    });
  });

  it.each([
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a mailto: link', 'mailto:someone@example.com'],
    ['something that is not a URL', 'not a url'],
  ])('never sends %s as the url', (_label, canonical) => {
    const params = buildBookmarkParams({ ...LINKED, canonical_url: canonical });
    expect(params).not.toHaveProperty('url');
    expect(params).toMatchObject({ is_private_from_source: 'email' });
  });

  it('never sends a Gmail permalink: a link-less post goes private even with a Message-ID', () => {
    // The Original link falls back to the mailbox; a send must not, or Instapaper saves a login wall.
    const source = { ...LINKED, canonical_url: null, rfc822_message_id: '<a@mail.example>' };
    const params = buildBookmarkParams(source);
    expect(JSON.stringify(params)).not.toContain('mail.google.com');
    expect(params).not.toHaveProperty('url');
  });

  it('is null when there is no link and no body — nothing Instapaper could save', () => {
    expect(buildBookmarkParams({ ...LINKED, canonical_url: null, html: null, text: null })).toBe(
      null,
    );
  });

  it('leaves the description out when there is no gist', () => {
    expect(buildBookmarkParams({ ...LINKED, gist: null })).not.toHaveProperty('description');
    expect(buildBookmarkParams({ ...LINKED, gist: '  ' })).not.toHaveProperty('description');
  });

  it('never sets tags, a folder, or resolve_final_url', () => {
    const keys = Object.keys(buildBookmarkParams(LINKED) ?? {});
    expect(keys).not.toContain('tags');
    expect(keys).not.toContain('folder_id');
    expect(keys).not.toContain('resolve_final_url');
  });
});

describe('addBookmark', () => {
  const PARAMS = { url: 'https://example.com/p/a', title: 'A post', content: '<p>Body</p>' };

  function respond(response: Response | Promise<Response>): jest.SpiedFunction<typeof fetch> {
    return jest.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(response));
  }

  function json(body: unknown, status = 200): Response {
    return Response.json(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function error(code: number, status = 400): Response {
    return json(
      [{ type: 'error', error_code: code, message: `Instapaper internal ${String(code)}` }],
      status,
    );
  }

  it('POSTs the params form-encoded to bookmarks/add, signed, with a timeout', async () => {
    const fetchSpy = respond(json([{ type: 'bookmark', bookmark_id: 1_234_567 }]));

    await addBookmark(CONFIG, PARAMS);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://www.instapaper.com/api/1/bookmarks/add');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-Type')).toBe('application/x-www-form-urlencoded; charset=utf-8');
    expect(headers.get('Authorization')).toMatch(/^OAuth oauth_consumer_key="ck", /);
    expect(headers.get('Authorization')).toContain('oauth_token="tk"');
    expect(typeof init?.body).toBe('string');
    expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual(PARAMS);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('is saved, with Instapaper’s bookmark id, when a bookmark comes back', async () => {
    respond(
      json([{ type: 'meta' }, { type: 'bookmark', bookmark_id: 1_234_567, title: 'A post' }]),
    );
    await expect(addBookmark(CONFIG, PARAMS)).resolves.toEqual({
      kind: 'saved',
      bookmarkId: 1_234_567,
    });
  });

  it.each([
    [1221, 'opted-out'],
    [1220, 'needs-content'],
    [1240, 'invalid-url'],
    [1040, 'rate-limited'],
    [1042, 'credentials'],
    [1041, 'premium'],
  ] as const)('reads error %i as the %s refusal', async (code, refusal) => {
    respond(error(code));
    await expect(addBookmark(CONFIG, PARAMS)).resolves.toEqual({ kind: 'refused', refusal, code });
  });

  it.each([401, 403])('reads an HTTP %i as rejected credentials', async (status) => {
    respond(new Response('Unauthorized', { status }));
    await expect(addBookmark(CONFIG, PARAMS)).resolves.toEqual({
      kind: 'refused',
      refusal: 'credentials',
      code: undefined,
    });
  });

  it.each([
    ['a 1246 (Instapaper’s own trouble)', error(1246, 400), 1246],
    ['an error code nobody documented', error(9999, 400), 9999],
    ['a 5xx', new Response('Bad gateway', { status: 503 }), undefined],
    ['a body that is not JSON', new Response('<html>oops</html>', { status: 200 }), undefined],
    ['a JSON body with no bookmark in it', json([{ type: 'meta' }]), undefined],
  ])('is unavailable on %s', async (_label, response, code) => {
    respond(response);
    await expect(addBookmark(CONFIG, PARAMS)).resolves.toEqual({ kind: 'unavailable', code });
  });

  it('is unavailable when the request times out or the network fails', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(addBookmark(CONFIG, PARAMS)).resolves.toEqual({
      kind: 'unavailable',
      code: undefined,
    });
    await expect(addBookmark(CONFIG, PARAMS)).resolves.toEqual({
      kind: 'unavailable',
      code: undefined,
    });
  });
});

describe('sendFailureResponse', () => {
  it.each<[string, Exclude<AddBookmarkOutcome, { kind: 'saved' }>, number, string]>([
    [
      'opted out',
      { kind: 'refused', refusal: 'opted-out', code: 1221 },
      422,
      'This publication has opted out of Instapaper',
    ],
    [
      'needs content',
      { kind: 'refused', refusal: 'needs-content', code: 1220 },
      422,
      "Instapaper can't fetch this post itself, and its stored text is gone",
    ],
    [
      'invalid URL',
      { kind: 'refused', refusal: 'invalid-url', code: 1240 },
      422,
      "Instapaper didn't accept this post's link",
    ],
    [
      'rate limited',
      { kind: 'refused', refusal: 'rate-limited', code: 1040 },
      429,
      'Instapaper is rate-limiting — try again in a minute',
    ],
    [
      'bad credentials',
      { kind: 'refused', refusal: 'credentials', code: undefined },
      502,
      "Instapaper rejected alfred's credentials",
    ],
    [
      'premium required',
      { kind: 'refused', refusal: 'premium', code: 1041 },
      502,
      'Instapaper says this needs a Premium account',
    ],
    [
      'unavailable',
      { kind: 'unavailable', code: 1246 },
      502,
      "Instapaper didn't answer — try again",
    ],
  ])('answers %s with its status and sentence', (_label, outcome, status, detail) => {
    expect(sendFailureResponse(outcome)).toEqual({ status, detail });
  });

  it('never repeats Instapaper’s own message, which is not meant for people', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json([{ type: 'error', error_code: 1221, message: 'Internal wording' }], {
          status: 400,
        }),
      );
    const outcome = await addBookmark(CONFIG, { title: 'x', url: 'https://example.com/p/x' });
    if (outcome.kind === 'saved') throw new Error('expected a refusal');
    expect(JSON.stringify(outcome)).not.toContain('Internal wording');
    expect(sendFailureResponse(outcome).detail).not.toContain('Internal wording');
  });
});
