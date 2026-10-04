import { INSTAPAPER_DEFAULT_API_URL, getInstapaperConfig } from './config';

jest.mock('server-only', () => ({}));

const KEYS = [
  'INSTAPAPER_CONSUMER_KEY',
  'INSTAPAPER_CONSUMER_SECRET',
  'INSTAPAPER_ACCESS_TOKEN',
  'INSTAPAPER_ACCESS_TOKEN_SECRET',
  'INSTAPAPER_API_URL',
] as const;

type InstapaperEnvironment = Partial<Record<(typeof KEYS)[number], string>>;

const CONFIGURED: InstapaperEnvironment = {
  INSTAPAPER_CONSUMER_KEY: 'ck',
  INSTAPAPER_CONSUMER_SECRET: 'cs',
  INSTAPAPER_ACCESS_TOKEN: 'at',
  INSTAPAPER_ACCESS_TOKEN_SECRET: 'ats',
};

const originalEnvironment = { ...process.env };

/** Exactly the vars the case declares — the ambient environment's are cleared first. */
function withEnvironment(values: InstapaperEnvironment): void {
  process.env = { ...originalEnvironment };
  for (const key of KEYS) {
    Reflect.deleteProperty(process.env, key);
    const value = values[key];
    if (value !== undefined) process.env[key] = value;
  }
}

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('getInstapaperConfig', () => {
  it('reads all four credentials and defaults the API URL to Instapaper', () => {
    withEnvironment(CONFIGURED);

    expect(getInstapaperConfig()).toEqual({
      consumerKey: 'ck',
      consumerSecret: 'cs',
      accessToken: 'at',
      accessTokenSecret: 'ats',
      apiUrl: INSTAPAPER_DEFAULT_API_URL,
    });
    expect(INSTAPAPER_DEFAULT_API_URL).toBe('https://www.instapaper.com');
  });

  it('takes an overridden API URL, without a trailing slash', () => {
    withEnvironment({ ...CONFIGURED, INSTAPAPER_API_URL: 'http://127.0.0.1:54321/' });

    expect(getInstapaperConfig()?.apiUrl).toBe('http://127.0.0.1:54321');
  });

  it.each(KEYS.slice(0, 4))('is null when %s is unset', (missing) => {
    withEnvironment({ ...CONFIGURED, [missing]: undefined });

    expect(getInstapaperConfig()).toBeNull();
  });

  it.each(KEYS.slice(0, 4))('is null when %s is blank', (blank) => {
    withEnvironment({ ...CONFIGURED, [blank]: ' '.repeat(3) });

    expect(getInstapaperConfig()).toBeNull();
  });
});
