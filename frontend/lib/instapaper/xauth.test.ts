/** @jest-environment node */
import { exchangeForAccessToken } from './xauth';

jest.mock('server-only', () => ({}));

const INPUT = {
  apiUrl: 'https://instapaper.test/',
  consumerKey: 'ck',
  consumerSecret: 'cs',
  username: 'owner@example.com',
  password: 'hunter2',
};

const originalFetch = globalThis.fetch;
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('exchangeForAccessToken', () => {
  it('POSTs a signed client_auth exchange and reads the token pair out of the answer', async () => {
    fetchMock.mockResolvedValue(new Response('oauth_token=tok&oauth_token_secret=sec'));

    await expect(exchangeForAccessToken(INPUT)).resolves.toEqual({
      token: 'tok',
      tokenSecret: 'sec',
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://instapaper.test/api/1/oauth/access_token');
    expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual({
      x_auth_username: 'owner@example.com',
      x_auth_password: 'hunter2',
      x_auth_mode: 'client_auth',
    });
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toMatch(/^OAuth .*oauth_consumer_key="ck"/);
    // There is no token yet to sign with.
    expect(headers['Authorization']).not.toContain('oauth_token=');
  });

  it('throws with Instapaper’s answer when it refuses', async () => {
    fetchMock.mockResolvedValue(new Response('Invalid xAuth credentials.', { status: 401 }));

    await expect(exchangeForAccessToken(INPUT)).rejects.toThrow(
      'Instapaper refused the exchange: HTTP 401 Invalid xAuth credentials.',
    );
  });

  it('throws when the answer carries no token', async () => {
    fetchMock.mockResolvedValue(new Response('something else'));

    await expect(exchangeForAccessToken(INPUT)).rejects.toThrow(
      'Instapaper answered without an access token',
    );
  });
});
