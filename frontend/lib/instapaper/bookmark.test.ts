/** @jest-environment node */
import {
  type AddBookmarkOutcome,
  NOTHING_TO_SEND,
  NOT_CONFIGURED,
  type SendablePost,
  addBookmark,
  buildBookmarkParams,
  sendFailure,
} from './bookmark';
import type { InstapaperConfig } from './config';
import { signRequest } from './oauth';

jest.mock('server-only', () => ({}));

/** A post with every optional part present; each case overrides what it is about. */
function post(overrides: Partial<SendablePost> = {}): SendablePost {
  return {
    title: 'A Post Worth Reading',
    canonical_url: 'https://example.substack.com/p/a-post',
    gist: null,
    html: null,
    text: null,
    ...overrides,
  };
}

type FetchArguments = Parameters<typeof fetch>;
type FetchStub = jest.Mock<Promise<Response>, FetchArguments>;

/** A typed `fetch` stand-in; `jest.fn` alone would leave every recorded call `any`. */
function stubFetch(implementation: (...args: FetchArguments) => Promise<Response>): FetchStub {
  return jest.fn<Promise<Response>, FetchArguments>(implementation);
}

/** A fetch stand-in answering every call with a fresh response (a body can be read once). */
function answering(body: string, status = 200): FetchStub {
  return stubFetch(() => Promise.resolve(new Response(body, { status })));
}

function answeringJson(body: unknown, status = 200): FetchStub {
  return answering(JSON.stringify(body), status);
}

/** The one request the stub saw, with the parts the assertions read. */
function sentRequest(stub: FetchStub): {
  url: string;
  init: RequestInit;
  headers: Headers;
  body: string;
} {
  const call = stub.mock.calls[0];
  if (call === undefined) throw new Error('fetch was never called');
  const [input, init = {}] = call;
  if (typeof input !== 'string') throw new Error('expected the URL as a string');
  if (typeof init.body !== 'string') throw new Error('expected the body as a string');
  return { url: input, init, headers: new Headers(init.headers), body: init.body };
}

/** Instapaper's error answer: a one-element array holding an `error` object. */
function refusal(code: number, message = 'Not for display'): string {
  return JSON.stringify([{ type: 'error', error_code: code, message }]);
}

describe('buildBookmarkParams', () => {
  describe('the link', () => {
    it('sends the canonical URL as the bookmark url, trimmed', () => {
      expect(buildBookmarkParams(post({ canonical_url: '  https://example.com/p?x=1  ' }))).toEqual(
        {
          title: 'A Post Worth Reading',
          url: 'https://example.com/p?x=1',
        },
      );
    });

    it('accepts plain http as well as https', () => {
      expect(buildBookmarkParams(post({ canonical_url: 'https://example.com/p' }))?.['url']).toBe(
        'https://example.com/p',
      );
    });

    it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://example.com/p', 'not a url'])(
      'never sends %s as the url — it becomes a private bookmark when there is text, else nothing',
      (canonical_url) => {
        expect(buildBookmarkParams(post({ canonical_url }))).toBeNull();

        const withText = buildBookmarkParams(post({ canonical_url, text: 'Some body text' }));
        expect(withText).not.toBeNull();
        expect(withText).not.toHaveProperty('url');
        expect(withText).toHaveProperty('is_private_from_source', 'email');
      },
    );

    it('sends no url when no link was ever found', () => {
      const params = buildBookmarkParams(post({ canonical_url: null, text: 'Body' }));

      expect(params).not.toHaveProperty('url');
    });

    it('treats a blank canonical URL as no link', () => {
      expect(buildBookmarkParams(post({ canonical_url: ' '.repeat(3) }))).toBeNull();
    });
  });

  describe('the content', () => {
    it('sends the stored HTML as the content when there is some', () => {
      const params = buildBookmarkParams(
        post({ html: '<p>Rich <b>body</b></p>', text: 'Rich body' }),
      );

      expect(params?.['content']).toBe('<p>Rich <b>body</b></p>');
    });

    it('falls back to the stored text, one paragraph per line, when the HTML is empty', () => {
      const params = buildBookmarkParams(
        post({ html: '  \n ', text: 'First line\nSecond & last' }),
      );

      expect(params?.['content']).toBe('<p>First line</p>\n<p>Second &amp; last</p>');
    });

    it('falls back to the stored text when there is no HTML at all', () => {
      const params = buildBookmarkParams(post({ html: null, text: 'Only text' }));

      expect(params?.['content']).toBe('<p>Only text</p>');
    });

    it('sends no content at all when both HTML and text are absent or blank', () => {
      expect(buildBookmarkParams(post({ html: null, text: null }))).not.toHaveProperty('content');
      expect(buildBookmarkParams(post({ html: ' ', text: '\n\n' }))).not.toHaveProperty('content');
    });

    it('sends the link alone when there is a link but nothing stored', () => {
      expect(buildBookmarkParams(post())).toEqual({
        title: 'A Post Worth Reading',
        url: 'https://example.substack.com/p/a-post',
      });
    });

    it('sends both the link and the content when it has both, as a public bookmark', () => {
      const params = buildBookmarkParams(post({ html: '<p>Body</p>' }));

      expect(params).toEqual({
        title: 'A Post Worth Reading',
        url: 'https://example.substack.com/p/a-post',
        content: '<p>Body</p>',
      });
      expect(params).not.toHaveProperty('is_private_from_source');
    });
  });

  describe('a bookmark with no link', () => {
    it('is private-from-email, carrying the content and no url', () => {
      expect(
        buildBookmarkParams(post({ canonical_url: null, html: '<p>Newsletter body</p>' })),
      ).toEqual({
        title: 'A Post Worth Reading',
        content: '<p>Newsletter body</p>',
        is_private_from_source: 'email',
      });
    });

    it('is nothing to send when there is neither a link nor any stored text', () => {
      expect(buildBookmarkParams(post({ canonical_url: null }))).toBeNull();
      expect(buildBookmarkParams(post({ canonical_url: null, html: '', text: '  ' }))).toBeNull();
    });
  });

  describe('title, description and what is never sent', () => {
    it('always sends the title', () => {
      expect(buildBookmarkParams(post({ title: 'Exactly This' }))?.['title']).toBe('Exactly This');
    });

    it('sends the gist as the description only when there is one', () => {
      expect(buildBookmarkParams(post({ gist: 'Why it matters.' }))?.['description']).toBe(
        'Why it matters.',
      );
      expect(buildBookmarkParams(post({ gist: null }))).not.toHaveProperty('description');
      expect(buildBookmarkParams(post({ gist: '' }))).not.toHaveProperty('description');
      expect(buildBookmarkParams(post({ gist: ' '.repeat(3) }))).not.toHaveProperty('description');
    });

    it('never sends tags, a folder, or a final-URL resolution — Instapaper defaults are right', () => {
      const posts = [
        post(),
        post({ gist: 'A gist', html: '<p>x</p>' }),
        post({ canonical_url: null, text: 'Body' }),
      ];

      for (const candidate of posts) {
        const params = buildBookmarkParams(candidate);
        expect(params).not.toBeNull();
        expect(params).not.toHaveProperty('tags');
        expect(params).not.toHaveProperty('folder_id');
        expect(params).not.toHaveProperty('resolve_final_url');
      }
    });
  });
});

describe('addBookmark', () => {
  const CONFIG: InstapaperConfig = {
    consumerKey: 'consumer-key',
    consumerSecret: 'consumer-secret',
    accessToken: 'access-token',
    accessTokenSecret: 'access-token-secret',
    apiUrl: 'https://www.instapaper.com',
  };
  const STAMP = { nonce: 'fixed-nonce', timestamp: '1700000000' };
  const PARAMS = { url: 'https://example.com/post', title: 'A Post Worth Reading' };
  const ADD_URL = 'https://www.instapaper.com/api/1/bookmarks/add';

  describe('the request', () => {
    it('posts the form to the bookmarks/add endpoint of the configured API', async () => {
      const stub = answeringJson([{ type: 'bookmark', bookmark_id: 1 }]);

      await addBookmark(CONFIG, PARAMS, { fetch: stub, stamp: STAMP });

      expect(stub).toHaveBeenCalledTimes(1);
      const { url, init, headers, body } = sentRequest(stub);
      expect(url).toBe(ADD_URL);
      expect(init.method).toBe('POST');
      expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded; charset=utf-8');
      expect(Object.fromEntries(new URLSearchParams(body))).toEqual(PARAMS);
    });

    it('targets whatever API origin the config names', async () => {
      const stub = answeringJson([{ type: 'bookmark', bookmark_id: 1 }]);

      await addBookmark({ ...CONFIG, apiUrl: 'http://127.0.0.1:4010' }, PARAMS, {
        fetch: stub,
        stamp: STAMP,
      });

      expect(sentRequest(stub).url).toBe('http://127.0.0.1:4010/api/1/bookmarks/add');
    });

    it('signs it with OAuth, using the access token and both secrets', async () => {
      const stub = answeringJson([{ type: 'bookmark', bookmark_id: 1 }]);

      await addBookmark(CONFIG, PARAMS, { fetch: stub, stamp: STAMP });

      const authorization = sentRequest(stub).headers.get('authorization');
      expect(authorization).toMatch(/^OAuth /);
      expect(authorization).toBe(
        signRequest(
          'POST',
          ADD_URL,
          PARAMS,
          {
            consumerKey: 'consumer-key',
            consumerSecret: 'consumer-secret',
            token: 'access-token',
            tokenSecret: 'access-token-secret',
          },
          STAMP,
        ),
      );
    });

    it('signs the decoded values, not the form encoding of them', async () => {
      // `URLSearchParams` writes the space as `+` and leaves `*` alone; the signature must
      // be computed over `%20` and `%2A`, or Instapaper's recomputation will disagree.
      const params = {
        title: "It's 100% (really) *new* & ünïcode",
        url: 'https://example.com/a b',
      };
      const stub = answeringJson([{ type: 'bookmark', bookmark_id: 1 }]);

      await addBookmark(CONFIG, params, { fetch: stub, stamp: STAMP });

      const { headers, body } = sentRequest(stub);
      expect(Object.fromEntries(new URLSearchParams(body))).toEqual(params);
      expect(headers.get('authorization')).toBe(
        signRequest(
          'POST',
          ADD_URL,
          params,
          {
            consumerKey: 'consumer-key',
            consumerSecret: 'consumer-secret',
            token: 'access-token',
            tokenSecret: 'access-token-secret',
          },
          STAMP,
        ),
      );
    });

    it('stamps each call with a fresh nonce when none is supplied', async () => {
      const stub = answeringJson([{ type: 'bookmark', bookmark_id: 1 }]);

      await addBookmark(CONFIG, PARAMS, { fetch: stub });
      await addBookmark(CONFIG, PARAMS, { fetch: stub });

      const nonces = stub.mock.calls.map(
        ([, init]) =>
          /oauth_nonce="([^"]+)"/.exec(new Headers(init?.headers).get('authorization') ?? '')?.[1],
      );
      expect(nonces[0]).toBeDefined();
      expect(nonces[1]).toBeDefined();
      expect(nonces[1]).not.toBe(nonces[0]);
    });

    it('gives up after 15 seconds unless told otherwise', async () => {
      const timeout = jest.spyOn(AbortSignal, 'timeout');
      const stub = answeringJson([{ type: 'bookmark', bookmark_id: 1 }]);

      await addBookmark(CONFIG, PARAMS, { fetch: stub, stamp: STAMP });

      expect(timeout).toHaveBeenCalledWith(15_000);
      expect(sentRequest(stub).init.signal).toBeInstanceOf(AbortSignal);
    });

    it('honours a different timeout', async () => {
      const timeout = jest.spyOn(AbortSignal, 'timeout');
      const stub = answeringJson([{ type: 'bookmark', bookmark_id: 1 }]);

      await addBookmark(CONFIG, PARAMS, { fetch: stub, stamp: STAMP, timeoutMs: 250 });

      expect(timeout).toHaveBeenCalledWith(250);
    });

    it('uses the global fetch when none is injected', async () => {
      const stub = answeringJson([{ type: 'bookmark', bookmark_id: 9 }]);
      jest.spyOn(globalThis, 'fetch').mockImplementation(stub);

      await expect(addBookmark(CONFIG, PARAMS, { stamp: STAMP })).resolves.toStrictEqual({
        kind: 'saved',
        bookmarkId: 9,
      });
      expect(stub).toHaveBeenCalledTimes(1);
    });
  });

  describe('reading the answer', () => {
    it('is saved, with the bookmark id, when Instapaper returns a bookmark', async () => {
      const stub = answeringJson([
        {
          type: 'bookmark',
          bookmark_id: 1_234_567,
          url: 'https://example.com/post',
          title: 'A Post Worth Reading',
          description: '',
          hash: 'abc123',
          progress: 0,
        },
      ]);

      await expect(addBookmark(CONFIG, PARAMS, { fetch: stub })).resolves.toStrictEqual({
        kind: 'saved',
        bookmarkId: 1_234_567,
      });
    });

    it('is saved even on a 201, which is what Instapaper answers a new bookmark with', async () => {
      const stub = answeringJson([{ type: 'bookmark', bookmark_id: 42 }], 201);

      await expect(addBookmark(CONFIG, PARAMS, { fetch: stub })).resolves.toStrictEqual({
        kind: 'saved',
        bookmarkId: 42,
      });
    });

    it('is refused, with the error code, when Instapaper returns an error', async () => {
      const stub = answeringJson(
        [{ type: 'error', error_code: 1221, message: 'Domain has opted out of Instapaper' }],
        400,
      );

      await expect(addBookmark(CONFIG, PARAMS, { fetch: stub })).resolves.toStrictEqual({
        kind: 'refused',
        code: 1221,
      });
    });

    it.each([401, 403])('is unauthorized on a %i, whatever the body says', async (status) => {
      const withErrorJson = answeringJson(
        [{ type: 'error', error_code: 1240, message: 'Invalid URL specified' }],
        status,
      );
      const withText = answering('Invalid credentials', status);
      const withNothing = answering('', status);

      for (const stub of [withErrorJson, withText, withNothing]) {
        await expect(addBookmark(CONFIG, PARAMS, { fetch: stub })).resolves.toStrictEqual({
          kind: 'unauthorized',
        });
      }
    });

    it.each([500, 502, 503, 504])('is unavailable on a %i', async (status) => {
      const stub = answeringJson(
        [{ type: 'error', error_code: 1221, message: 'Whatever it said' }],
        status,
      );

      await expect(addBookmark(CONFIG, PARAMS, { fetch: stub })).resolves.toStrictEqual({
        kind: 'unavailable',
      });
    });

    it('is unavailable when the body is not JSON, which Instapaper documents as a 503', async () => {
      const stub = answering('<html>Service Temporarily Unavailable</html>', 200);

      await expect(addBookmark(CONFIG, PARAMS, { fetch: stub })).resolves.toStrictEqual({
        kind: 'unavailable',
      });
    });

    it.each([
      ['an empty array', []],
      ['a bare object', { type: 'bookmark', bookmark_id: 1 }],
      ['an array of something else', [{ type: 'user', user_id: 7 }]],
      ['a bookmark with no numeric id', [{ type: 'bookmark', bookmark_id: 'abc' }]],
      ['an error with no numeric code', [{ type: 'error', message: 'Nope' }]],
      ['null', null],
    ])('is unavailable when the JSON is %s', async (_name, body) => {
      const stub = answeringJson(body, 200);

      await expect(addBookmark(CONFIG, PARAMS, { fetch: stub })).resolves.toStrictEqual({
        kind: 'unavailable',
      });
    });

    it('is unavailable on a 4xx that carries no error object', async () => {
      const stub = answering('Bad request', 400);

      await expect(addBookmark(CONFIG, PARAMS, { fetch: stub })).resolves.toStrictEqual({
        kind: 'unavailable',
      });
    });
  });

  describe('when the call itself fails', () => {
    it('is unavailable when the network fails', async () => {
      const stub = stubFetch(() => Promise.reject(new TypeError('fetch failed')));

      await expect(addBookmark(CONFIG, PARAMS, { fetch: stub })).resolves.toStrictEqual({
        kind: 'unavailable',
      });
    });

    it.each(['TimeoutError', 'AbortError'])(
      'is unavailable when the call is aborted (%s)',
      async (name) => {
        const stub = stubFetch(() =>
          Promise.reject(new DOMException('The operation was aborted.', name)),
        );

        await expect(addBookmark(CONFIG, PARAMS, { fetch: stub })).resolves.toStrictEqual({
          kind: 'unavailable',
        });
      },
    );

    it('really does give up on a call that never answers', async () => {
      // A fetch that honours its abort signal and otherwise hangs forever.
      const hanging = stubFetch(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener('abort', () => {
              reject(signal.reason as Error);
            });
          }),
      );

      await expect(
        addBookmark(CONFIG, PARAMS, { fetch: hanging, timeoutMs: 20 }),
      ).resolves.toStrictEqual({ kind: 'unavailable' });
    });

    it('is unavailable when the body cannot be read', async () => {
      const broken = stubFetch(() =>
        Promise.resolve({
          status: 200,
          json: () => Promise.reject(new TypeError('terminated')),
        } as unknown as Response),
      );

      await expect(addBookmark(CONFIG, PARAMS, { fetch: broken })).resolves.toStrictEqual({
        kind: 'unavailable',
      });
    });

    it('never throws, even when the configured API URL is unusable', async () => {
      const stub = answeringJson([{ type: 'bookmark', bookmark_id: 1 }]);

      await expect(
        addBookmark({ ...CONFIG, apiUrl: 'not a url' }, PARAMS, { fetch: stub }),
      ).resolves.toStrictEqual({ kind: 'unavailable' });
      expect(stub).not.toHaveBeenCalled();
    });
  });

  describe("Instapaper's own message", () => {
    const MESSAGE = 'Domain has opted out of Instapaper compatibility';

    it('is never carried into the outcome or the answer built from it', async () => {
      const stub = answeringJson([{ type: 'error', error_code: 1221, message: MESSAGE }], 400);

      const outcome = await addBookmark(CONFIG, PARAMS, { fetch: stub });

      expect(outcome.kind).toBe('refused');
      expect(JSON.stringify(outcome)).not.toContain(MESSAGE);
      if (outcome.kind === 'saved') throw new Error('expected a refusal');
      expect(JSON.stringify(sendFailure(outcome))).not.toContain(MESSAGE);
    });

    it('is not echoed for any other outcome either', async () => {
      const stub = answeringJson([{ type: 'error', error_code: 9999, message: MESSAGE }], 400);

      const outcome = await addBookmark(CONFIG, PARAMS, { fetch: stub });

      expect(JSON.stringify(outcome)).not.toContain(MESSAGE);
      if (outcome.kind === 'saved') throw new Error('expected a refusal');
      expect(JSON.stringify(sendFailure(outcome))).not.toContain(MESSAGE);
    });
  });
});

describe('sendFailure', () => {
  type Failure = Exclude<AddBookmarkOutcome, { kind: 'saved' }>;

  const OPTED_OUT = { status: 422, message: 'This publication has opted out of Instapaper' };
  const NEEDS_CONTENT = {
    status: 422,
    message: "Instapaper can't fetch this post itself, and its stored text is gone",
  };
  const BAD_LINK = { status: 422, message: "Instapaper didn't accept this post's link" };
  const RATE_LIMITED = {
    status: 429,
    message: 'Instapaper is rate-limiting — try again in a minute',
  };
  const REJECTED = { status: 502, message: "Instapaper rejected alfred's credentials" };
  const PREMIUM = { status: 502, message: 'Instapaper says this needs a Premium account' };
  const NO_ANSWER = { status: 502, message: "Instapaper didn't answer — try again" };

  it.each<[string, Failure, { status: number; message: string }]>([
    ['refused 1221', { kind: 'refused', code: 1221 }, OPTED_OUT],
    ['refused 1220', { kind: 'refused', code: 1220 }, NEEDS_CONTENT],
    ['refused 1240', { kind: 'refused', code: 1240 }, BAD_LINK],
    ['refused 1040', { kind: 'refused', code: 1040 }, RATE_LIMITED],
    ['unauthorized', { kind: 'unauthorized' }, REJECTED],
    ['refused 1042', { kind: 'refused', code: 1042 }, REJECTED],
    ['refused 1041', { kind: 'refused', code: 1041 }, PREMIUM],
    ['unavailable', { kind: 'unavailable' }, NO_ANSWER],
    ['refused 1246', { kind: 'refused', code: 1246 }, NO_ANSWER],
    ['an unrecognised refusal', { kind: 'refused', code: 4711 }, NO_ANSWER],
  ])('answers %s', (_name, outcome, expected) => {
    expect(sendFailure(outcome)).toStrictEqual(expected);
  });

  describe('from a realistic response, end to end', () => {
    const CONFIG: InstapaperConfig = {
      consumerKey: 'ck',
      consumerSecret: 'cs',
      accessToken: 'at',
      accessTokenSecret: 'ats',
      apiUrl: 'https://www.instapaper.com',
    };

    async function failureFor(body: string, status: number): Promise<Failure> {
      const stub = stubFetch(() => Promise.resolve(new Response(body, { status })));
      const outcome = await addBookmark(
        CONFIG,
        { title: 'T', url: 'https://example.com' },
        {
          fetch: stub,
        },
      );
      if (outcome.kind === 'saved') throw new Error('expected a failure');
      return outcome;
    }

    it.each([
      [400, 1221, OPTED_OUT],
      [400, 1220, NEEDS_CONTENT],
      [400, 1240, BAD_LINK],
      [400, 1040, RATE_LIMITED],
      [400, 1042, REJECTED],
      [400, 1041, PREMIUM],
      [400, 1246, NO_ANSWER],
    ])('maps an HTTP %i refusal with code %i', async (status, code, expected) => {
      expect(sendFailure(await failureFor(refusal(code), status))).toStrictEqual(expected);
    });

    it.each([401, 403])('maps an HTTP %i to the credentials answer', async (status) => {
      expect(sendFailure(await failureFor('', status))).toStrictEqual(REJECTED);
    });

    it.each([500, 503])('maps an HTTP %i to the no-answer answer', async (status) => {
      expect(sendFailure(await failureFor('', status))).toStrictEqual(NO_ANSWER);
    });
  });
});

describe('the answers given before any call is made', () => {
  it('says plainly when the deployment has no Instapaper credentials', () => {
    expect(NOT_CONFIGURED).toStrictEqual({
      status: 501,
      message: "Instapaper isn't set up on this deployment",
    });
  });

  it('says plainly when the post has neither a link nor any stored text', () => {
    expect(NOTHING_TO_SEND).toStrictEqual({
      status: 409,
      message: 'Nothing to send — this post has no link and no stored text',
    });
  });
});
