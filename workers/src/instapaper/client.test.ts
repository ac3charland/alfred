import { type FetchInit, spyOnFetch } from '../fetch-stub';
import {
  INSTAPAPER_API_URL,
  InstapaperError,
  instapaperClient,
  instapaperCredentials,
} from './client';
import { type SigningMoment, signRequest } from './oauth';
import type { InstapaperCredentials } from './types';

const CREDENTIALS: InstapaperCredentials = {
  consumerKey: 'CK-secret-1',
  consumerSecret: 'CS-secret-2',
  token: 'TK-secret-3',
  tokenSecret: 'TS-secret-4',
};
const SECRETS = Object.values(CREDENTIALS);
const MOMENT: SigningMoment = { nonce: 'n0nce', timestamp: 1_789_000_000 };

function client() {
  return instapaperClient(CREDENTIALS, { moment: () => MOMENT });
}

/** Answer every call with this body and status, and hand back the spy to inspect. */
function answer(body: string, status = 200) {
  return spyOnFetch().mockImplementation(() => Promise.resolve(new Response(body, { status })));
}

/** The one call the spy saw: its URL, its init, and its form body decoded. */
function onlyCall(spy: ReturnType<typeof spyOnFetch>): {
  url: string;
  init: FetchInit;
  form: Record<string, string>;
} {
  expect(spy).toHaveBeenCalledTimes(1);
  const [input, init] = spy.mock.calls[0] ?? [];
  const body = typeof init?.body === 'string' ? init.body : '';
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  return { url: url ?? '', init, form: Object.fromEntries(new URLSearchParams(body)) };
}

/** The Authorization header the call should carry, computed without the client. */
function expectedAuthorization(path: string, params: Record<string, string>): string {
  return signRequest('POST', `${INSTAPAPER_API_URL}${path}`, params, CREDENTIALS, MOMENT);
}

/** What the call threw, so its kind, code and message can each be asserted. */
async function failureOf(promise: Promise<unknown>): Promise<InstapaperError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof InstapaperError) return error;
    throw error;
  }
  throw new Error('the call resolved');
}

describe('instapaperCredentials', () => {
  const FULL = {
    INSTAPAPER_CONSUMER_KEY: ' ck ',
    INSTAPAPER_CONSUMER_SECRET: 'cs',
    INSTAPAPER_ACCESS_TOKEN: 'tk',
    INSTAPAPER_ACCESS_TOKEN_SECRET: 'ts',
  };

  it('reads all four values, trimmed', () => {
    expect(instapaperCredentials(FULL)).toEqual({
      consumerKey: 'ck',
      consumerSecret: 'cs',
      token: 'tk',
      tokenSecret: 'ts',
    });
  });

  it.each(Object.keys(FULL))('is off when %s is missing or blank', (name) => {
    const missing = Object.fromEntries(Object.entries(FULL).filter(([key]) => key !== name));
    expect(instapaperCredentials(missing)).toBeUndefined();
    expect(instapaperCredentials({ ...FULL, [name]: ' '.repeat(3) })).toBeUndefined();
  });
});

describe('the request each method sends', () => {
  it.each([
    ['listFolders', '/api/1.1/folders/list', {}, '[]', () => client().listFolders()],
    [
      'listBookmarks',
      '/api/1.1/bookmarks/list',
      { folder_id: '42', limit: '500' },
      '{"bookmarks":[]}',
      () => client().listBookmarks(42),
    ],
    [
      'getText',
      '/api/1.1/bookmarks/get_text',
      { bookmark_id: '7' },
      '<p>hi</p>',
      () => client().getText(7),
    ],
    [
      'archive',
      '/api/1/bookmarks/archive',
      { bookmark_id: '7' },
      '[{"type":"bookmark","bookmark_id":7}]',
      () => client().archive(7),
    ],
  ] as const)('%s POSTs %s with its form body, signed', async (_name, path, params, body, call) => {
    const spy = answer(body);
    await call();

    const sent = onlyCall(spy);
    expect(sent.url).toBe(`${INSTAPAPER_API_URL}${path}`);
    expect(sent.init?.method).toBe('POST');
    expect(sent.form).toEqual(params);
    expect(sent.init?.headers).toMatchObject({
      Authorization: expectedAuthorization(path, params),
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    });
    expect(sent.init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('listFolders', () => {
  it('reads each folder, skipping anything without an id and a title', async () => {
    answer(
      JSON.stringify([
        { type: 'folder', folder_id: 123, title: 'To Wiki' },
        { type: 'folder', folder_id: '456', title: 'To Reader' },
        { type: 'user', user_id: 5 },
        { type: 'folder' },
      ]),
    );
    await expect(client().listFolders()).resolves.toEqual([
      { folderId: 123, title: 'To Wiki' },
      { folderId: 456, title: 'To Reader' },
    ]);
  });
});

describe('listBookmarks', () => {
  const BOOKMARK = {
    type: 'bookmark',
    bookmark_id: 1,
    url: 'https://example.com/a',
    title: 'A',
    time: 1_700_000_000,
  };
  const READ = { bookmarkId: 1, url: 'https://example.com/a', title: 'A', time: 1_700_000_000 };

  it('reads the API 1.1 object shape, ignoring its highlights', async () => {
    answer(
      JSON.stringify({
        user: { type: 'user' },
        bookmarks: [BOOKMARK],
        highlights: [{ type: 'highlight', highlight_id: 9, bookmark_id: 1, text: 'quote' }],
      }),
    );
    await expect(client().listBookmarks(1)).resolves.toEqual([READ]);
  });

  it('reads the older flat array shape, keeping only bookmarks', async () => {
    answer(
      JSON.stringify([
        { type: 'user', user_id: 5 },
        BOOKMARK,
        { type: 'highlight', highlight_id: 9, bookmark_id: 1 },
      ]),
    );
    await expect(client().listBookmarks(1)).resolves.toEqual([READ]);
  });

  it('reads numeric strings, and defaults a missing url, title and time', async () => {
    answer(JSON.stringify({ bookmarks: [{ bookmark_id: '2', time: '17' }, { title: 'no id' }] }));
    await expect(client().listBookmarks(1)).resolves.toEqual([
      { bookmarkId: 2, url: '', title: '', time: 17 },
    ]);
  });

  it('refuses an answer in neither shape', async () => {
    answer('{"user":{}}');
    const error = await failureOf(client().listBookmarks(1));
    expect(error.kind).toBe('unavailable');
    expect(error.message).toBe('bookmarks/list: unavailable (unexpected answer)');
  });
});

describe('getText', () => {
  it('answers the HTML Instapaper returns', async () => {
    answer('<html><body><p>The article.</p></body></html>');
    await expect(client().getText(7)).resolves.toBe(
      '<html><body><p>The article.</p></body></html>',
    );
  });

  it('answers undefined for error 1550, when Instapaper could not generate text', async () => {
    answer('[{"type":"error","error_code":1550,"message":"Error generating text"}]', 400);
    await expect(client().getText(7)).resolves.toBeUndefined();
  });

  it('never takes a 2xx JSON body for article text', async () => {
    answer('[{"type":"bookmark","bookmark_id":7}]');
    const error = await failureOf(client().getText(7));
    expect(error.kind).toBe('unavailable');
    expect(error.message).toBe('bookmarks/get_text: unavailable (unexpected answer)');
  });
});

describe('archive', () => {
  it('resolves once Instapaper answers with the bookmark', async () => {
    answer('[{"type":"bookmark","bookmark_id":7}]');
    await expect(client().archive(7)).resolves.toBeUndefined();
  });

  it('resolves when the bookmark no longer exists: there is nothing left to archive', async () => {
    answer('[{"type":"error","error_code":1241,"message":"Invalid or missing bookmark_id"}]', 400);
    await expect(client().archive(7)).resolves.toBeUndefined();
  });
});

describe('failures', () => {
  it.each([
    ['a 401', 401, '{}', 'credentials', undefined],
    ['a 403', 403, 'Forbidden', 'credentials', undefined],
    ['error 1042 (suspended)', 400, '[{"type":"error","error_code":1042}]', 'credentials', 1042],
    ['error 1040', 400, '[{"type":"error","error_code":1040}]', 'rate-limited', 1040],
    ['error 1041', 400, '[{"type":"error","error_code":"1041"}]', 'premium', 1041],
    ['another error code', 400, '[{"type":"error","error_code":1500}]', 'unavailable', 1500],
    ['an error item at 200', 200, '[{"type":"error","error_code":1500}]', 'unavailable', 1500],
    ['a 503 with no body worth reading', 503, 'Service Unavailable', 'unavailable', undefined],
    ['a 2xx body that is not JSON', 200, '<html>oops</html>', 'unavailable', undefined],
  ] as const)('maps %s on a JSON call to %s', async (_label, status, body, kind, code) => {
    answer(body, status);
    const error = await failureOf(client().listFolders());
    expect(error.kind).toBe(kind);
    expect(error.code).toBe(code);
    expect(error.message).toMatch(/^folders\/list: /);
  });

  it('maps a credentials refusal on get_text, not only on JSON calls', async () => {
    answer('Unauthorized', 401);
    const error = await failureOf(client().getText(7));
    expect(error.kind).toBe('credentials');
    expect(error.message).toBe('bookmarks/get_text: credentials');
  });

  it('names the call, the kind and the code', async () => {
    answer('[{"type":"error","error_code":1040}]', 400);
    const error = await failureOf(client().archive(7));
    expect(error.message).toBe('bookmarks/archive: rate-limited (error 1040)');
  });

  it('reads a network failure as unavailable, without echoing the thrown message', async () => {
    spyOnFetch().mockRejectedValue(new TypeError(`fetch failed for ${CREDENTIALS.token}`));
    const error = await failureOf(client().listFolders());
    expect(error.kind).toBe('unavailable');
    expect(error.message).toBe('folders/list: unavailable (network error)');
  });

  it('reads a timeout as unavailable, and says so', async () => {
    spyOnFetch().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    const error = await failureOf(client().getText(7));
    expect(error.message).toBe('bookmarks/get_text: unavailable (timeout)');
  });

  it('never puts a credential in a message', async () => {
    const messages: string[] = [];
    for (const [status, body] of [
      [401, `bad token ${CREDENTIALS.token}`],
      [400, `[{"type":"error","error_code":1500,"message":"${CREDENTIALS.consumerKey}"}]`],
      [200, `not json ${CREDENTIALS.tokenSecret}`],
    ] as const) {
      answer(body, status);
      const error = await failureOf(client().listFolders());
      messages.push(error.message);
    }
    for (const message of messages) {
      for (const secret of SECRETS) expect(message).not.toContain(secret);
    }
  });
});
