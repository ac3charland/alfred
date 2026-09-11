import { spyOnFetch } from '../fetch-stub';
import { TOKEN_ENDPOINT, fetchAccessToken } from './gmail-oauth';

const env = {
  GMAIL_OAUTH_CLIENT_ID: 'client-id',
  GMAIL_OAUTH_CLIENT_SECRET: 'client-secret',
};

interface Call {
  url: string;
  method: string | undefined;
  body: URLSearchParams;
}

function mockToken(respond: () => Response): Call[] {
  const calls: Call[] = [];
  spyOnFetch().mockImplementation((input, init) => {
    calls.push({
      url: input as string,
      method: init?.method,
      body: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    });
    return Promise.resolve(respond());
  });
  return calls;
}

describe('fetchAccessToken', () => {
  it('posts the refresh grant form-encoded', async () => {
    const calls = mockToken(() => Response.json({ access_token: 'ya29.token' }));

    await expect(fetchAccessToken(env, 'refresh-token')).resolves.toEqual({
      ok: true,
      token: 'ya29.token',
    });
    expect(calls[0]?.url).toBe(TOKEN_ENDPOINT);
    expect(calls[0]?.method).toBe('POST');
    expect(Object.fromEntries(calls[0]?.body ?? new URLSearchParams())).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      refresh_token: 'refresh-token',
      grant_type: 'refresh_token',
    });
  });

  it.each([400, 401])(
    'reads invalid_grant on a %i as a dead token only a human can replace',
    async (status) => {
      mockToken(() => new Response('{"error":"invalid_grant"}', { status }));

      await expect(fetchAccessToken(env, 'refresh-token')).resolves.toEqual({
        ok: false,
        reason: 'rejected',
        detail: '{"error":"invalid_grant"}',
      });
    },
  );

  it('reads a 400 that is not invalid_grant as worth retrying', async () => {
    mockToken(() => new Response('{"error":"internal_failure"}', { status: 400 }));

    const result = await fetchAccessToken(env, 'refresh-token');
    expect(result).toEqual({
      ok: false,
      reason: 'transport',
      detail: '{"error":"internal_failure"}',
    });
  });

  it('reads a 5xx as transport', async () => {
    mockToken(() => new Response('bad gateway', { status: 502 }));

    await expect(fetchAccessToken(env, 'r')).resolves.toEqual({
      ok: false,
      reason: 'transport',
      detail: 'bad gateway',
    });
  });

  it('reads a thrown fetch as transport', async () => {
    spyOnFetch().mockImplementation(() => Promise.reject(new Error('dns failure')));

    await expect(fetchAccessToken(env, 'r')).resolves.toEqual({
      ok: false,
      reason: 'transport',
      detail: 'dns failure',
    });
  });

  it('refuses a 200 that carried no token rather than handing back an empty one', async () => {
    mockToken(() => Response.json({ expires_in: 3599 }));

    await expect(fetchAccessToken(env, 'r')).resolves.toEqual({
      ok: false,
      reason: 'transport',
      detail: 'token response carried no access_token',
    });
  });

  it('never puts either token in the failure detail', async () => {
    mockToken(() => new Response('{"error":"invalid_grant"}', { status: 400 }));

    const result = await fetchAccessToken(env, 'super-secret-refresh-token');
    expect(JSON.stringify(result)).not.toContain('super-secret-refresh-token');
  });
});
