import { DEFAULT_INSTAPAPER_API_URL, getInstapaperConfig } from './config';

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

const CREDENTIAL_KEYS = [
  'INSTAPAPER_CONSUMER_KEY',
  'INSTAPAPER_CONSUMER_SECRET',
  'INSTAPAPER_ACCESS_TOKEN',
  'INSTAPAPER_ACCESS_TOKEN_SECRET',
] as const;

const originalEnvironment = { ...process.env };

/**
 * Give this feature exactly the vars the case declares, and nothing else. All five are cleared
 * first because the ambient environment may well carry some of its own (the E2E harness sets
 * them) — an "unset" case would otherwise inherit them and assert nothing.
 */
function withEnvironment(values: InstapaperEnvironment): void {
  process.env = { ...originalEnvironment };
  delete process.env.INSTAPAPER_CONSUMER_KEY;
  delete process.env.INSTAPAPER_CONSUMER_SECRET;
  delete process.env.INSTAPAPER_ACCESS_TOKEN;
  delete process.env.INSTAPAPER_ACCESS_TOKEN_SECRET;
  delete process.env.INSTAPAPER_API_URL;

  for (const [name, value] of Object.entries(values) as [string, string | undefined][]) {
    if (value !== undefined) process.env[name] = value;
  }
}

describe('getInstapaperConfig', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('reads the four credentials and defaults the API URL', () => {
    withEnvironment(CONFIGURED);
    expect(getInstapaperConfig()).toEqual({
      consumerKey: 'consumer-key',
      consumerSecret: 'consumer-secret',
      accessToken: 'access-token',
      accessTokenSecret: 'access-token-secret',
      apiUrl: DEFAULT_INSTAPAPER_API_URL,
    });
    expect(DEFAULT_INSTAPAPER_API_URL).toBe('https://www.instapaper.com');
  });

  it.each(CREDENTIAL_KEYS)('is null when %s is unset', (missing) => {
    // Three of four credentials would fail at Instapaper with a signature error the owner can do
    // nothing about, so a partial configuration counts as none and the verb says it isn't set up.
    withEnvironment({ ...CONFIGURED, [missing]: undefined });
    expect(getInstapaperConfig()).toBeNull();
  });

  it.each(CREDENTIAL_KEYS)('is null when %s is blank', (blank) => {
    withEnvironment({ ...CONFIGURED, [blank]: ' '.repeat(3) });
    expect(getInstapaperConfig()).toBeNull();
  });

  it('is null on a deployment with none of them set', () => {
    withEnvironment({});
    expect(getInstapaperConfig()).toBeNull();
  });

  it('takes an overridden API URL, trailing slash and all', () => {
    // The E2E mock stands in for Instapaper through this var; the trim is what lets a path be
    // appended to it directly.
    withEnvironment({ ...CONFIGURED, INSTAPAPER_API_URL: 'http://localhost:54331/' });
    expect(getInstapaperConfig()?.apiUrl).toBe('http://localhost:54331');
  });

  it('ignores a blank API URL override and takes the default', () => {
    withEnvironment({ ...CONFIGURED, INSTAPAPER_API_URL: '  ' });
    expect(getInstapaperConfig()?.apiUrl).toBe(DEFAULT_INSTAPAPER_API_URL);
  });

  it('trims surrounding whitespace off a credential', () => {
    // A value pasted into a Vercel field routinely arrives with a trailing newline, and a signing
    // key with one in it fails every call.
    withEnvironment({ ...CONFIGURED, INSTAPAPER_CONSUMER_SECRET: '  consumer-secret\n' });
    expect(getInstapaperConfig()?.consumerSecret).toBe('consumer-secret');
  });

  it('reads no NEXT_PUBLIC_ variant of any credential', () => {
    // The guard against the one mistake that would put the owner's token in the browser bundle.
    withEnvironment({});
    process.env['NEXT_PUBLIC_INSTAPAPER_CONSUMER_KEY'] = 'leaked';
    process.env['NEXT_PUBLIC_INSTAPAPER_CONSUMER_SECRET'] = 'leaked';
    process.env['NEXT_PUBLIC_INSTAPAPER_ACCESS_TOKEN'] = 'leaked';
    process.env['NEXT_PUBLIC_INSTAPAPER_ACCESS_TOKEN_SECRET'] = 'leaked';
    expect(getInstapaperConfig()).toBeNull();
  });
});
