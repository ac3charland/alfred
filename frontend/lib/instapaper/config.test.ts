import { INSTAPAPER_DEFAULT_API_URL, getInstapaperConfig } from './config';

jest.mock('server-only', () => ({}));

/** The five vars this feature reads. `undefined` means "unset on this deployment". */
interface InstapaperEnvironment {
  INSTAPAPER_CONSUMER_KEY?: string | undefined;
  INSTAPAPER_CONSUMER_SECRET?: string | undefined;
  INSTAPAPER_ACCESS_TOKEN?: string | undefined;
  INSTAPAPER_ACCESS_TOKEN_SECRET?: string | undefined;
  INSTAPAPER_API_URL?: string | undefined;
}

const CONFIGURED: InstapaperEnvironment = {
  INSTAPAPER_CONSUMER_KEY: 'consumer-key',
  INSTAPAPER_CONSUMER_SECRET: 'consumer-secret',
  INSTAPAPER_ACCESS_TOKEN: 'access-token',
  INSTAPAPER_ACCESS_TOKEN_SECRET: 'access-token-secret',
};

const CREDENTIAL_NAMES = [
  'INSTAPAPER_CONSUMER_KEY',
  'INSTAPAPER_CONSUMER_SECRET',
  'INSTAPAPER_ACCESS_TOKEN',
  'INSTAPAPER_ACCESS_TOKEN_SECRET',
] as const;

const originalEnvironment = { ...process.env };

/**
 * Give this feature exactly the vars the case declares, and nothing else. All five are cleared
 * first because the ambient environment may well carry real Instapaper credentials of its own
 * (a dev machine that has run the token script) — an "unset" case would otherwise inherit them
 * and assert nothing.
 */
function withEnvironment(values: InstapaperEnvironment): void {
  process.env = { ...originalEnvironment };
  delete process.env.INSTAPAPER_CONSUMER_KEY;
  delete process.env.INSTAPAPER_CONSUMER_SECRET;
  delete process.env.INSTAPAPER_ACCESS_TOKEN;
  delete process.env.INSTAPAPER_ACCESS_TOKEN_SECRET;
  delete process.env.INSTAPAPER_API_URL;

  if (values.INSTAPAPER_CONSUMER_KEY !== undefined) {
    process.env.INSTAPAPER_CONSUMER_KEY = values.INSTAPAPER_CONSUMER_KEY;
  }
  if (values.INSTAPAPER_CONSUMER_SECRET !== undefined) {
    process.env.INSTAPAPER_CONSUMER_SECRET = values.INSTAPAPER_CONSUMER_SECRET;
  }
  if (values.INSTAPAPER_ACCESS_TOKEN !== undefined) {
    process.env.INSTAPAPER_ACCESS_TOKEN = values.INSTAPAPER_ACCESS_TOKEN;
  }
  if (values.INSTAPAPER_ACCESS_TOKEN_SECRET !== undefined) {
    process.env.INSTAPAPER_ACCESS_TOKEN_SECRET = values.INSTAPAPER_ACCESS_TOKEN_SECRET;
  }
  if (values.INSTAPAPER_API_URL !== undefined) {
    process.env.INSTAPAPER_API_URL = values.INSTAPAPER_API_URL;
  }
}

describe('getInstapaperConfig', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('reads the four credentials and defaults the API URL to the real service', () => {
    withEnvironment(CONFIGURED);

    expect(getInstapaperConfig()).toStrictEqual({
      consumerKey: 'consumer-key',
      consumerSecret: 'consumer-secret',
      accessToken: 'access-token',
      accessTokenSecret: 'access-token-secret',
      apiUrl: 'https://www.instapaper.com',
    });
    expect(INSTAPAPER_DEFAULT_API_URL).toBe('https://www.instapaper.com');
  });

  it.each(CREDENTIAL_NAMES)('is unconfigured when %s is unset', (name) => {
    withEnvironment({ ...CONFIGURED, [name]: undefined });

    expect(getInstapaperConfig()).toBeNull();
  });

  it.each(CREDENTIAL_NAMES)('treats a blank %s as unset', (name) => {
    withEnvironment({ ...CONFIGURED, [name]: ' '.repeat(3) });

    expect(getInstapaperConfig()).toBeNull();
  });

  it('is unconfigured when nothing is set at all', () => {
    withEnvironment({});

    expect(getInstapaperConfig()).toBeNull();
  });

  it('trims whitespace around each credential', () => {
    withEnvironment({
      INSTAPAPER_CONSUMER_KEY: '  consumer-key ',
      INSTAPAPER_CONSUMER_SECRET: '\tconsumer-secret\n',
      INSTAPAPER_ACCESS_TOKEN: ' access-token',
      INSTAPAPER_ACCESS_TOKEN_SECRET: 'access-token-secret  ',
    });

    expect(getInstapaperConfig()).toMatchObject({
      consumerKey: 'consumer-key',
      consumerSecret: 'consumer-secret',
      accessToken: 'access-token',
      accessTokenSecret: 'access-token-secret',
    });
  });

  it('honours an overridden API URL, which is how the E2E mock stands in for Instapaper', () => {
    withEnvironment({ ...CONFIGURED, INSTAPAPER_API_URL: 'http://127.0.0.1:4010' });

    expect(getInstapaperConfig()?.apiUrl).toBe('http://127.0.0.1:4010');
  });

  it('strips trailing slashes from the API URL so the path joins cleanly', () => {
    withEnvironment({ ...CONFIGURED, INSTAPAPER_API_URL: ' http://127.0.0.1:4010// ' });

    expect(getInstapaperConfig()?.apiUrl).toBe('http://127.0.0.1:4010');
  });

  it('falls back to the default API URL when the override is blank', () => {
    withEnvironment({ ...CONFIGURED, INSTAPAPER_API_URL: ' '.repeat(3) });

    expect(getInstapaperConfig()?.apiUrl).toBe(INSTAPAPER_DEFAULT_API_URL);
  });

  it('does not need the API URL override to be set for the feature to be configured', () => {
    withEnvironment({ ...CONFIGURED, INSTAPAPER_API_URL: undefined });

    expect(getInstapaperConfig()).not.toBeNull();
  });
});
