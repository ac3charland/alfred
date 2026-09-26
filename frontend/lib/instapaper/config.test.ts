/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { DEFAULT_INSTAPAPER_API_URL, getInstapaperConfig } from './config';

jest.mock('server-only', () => ({}));

const CREDENTIAL_VARS = [
  'INSTAPAPER_CONSUMER_KEY',
  'INSTAPAPER_CONSUMER_SECRET',
  'INSTAPAPER_ACCESS_TOKEN',
  'INSTAPAPER_ACCESS_TOKEN_SECRET',
] as const;

const CONFIGURED: Record<(typeof CREDENTIAL_VARS)[number], string> = {
  INSTAPAPER_CONSUMER_KEY: 'ck',
  INSTAPAPER_CONSUMER_SECRET: 'cs',
  INSTAPAPER_ACCESS_TOKEN: 'tk',
  INSTAPAPER_ACCESS_TOKEN_SECRET: 'ts',
};

const originalEnvironment = { ...process.env };

/** The environment with every `INSTAPAPER_*` var taken out. */
function withoutInstapaper(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !name.startsWith('INSTAPAPER_')),
  ) as NodeJS.ProcessEnv;
}

/**
 * Give the feature exactly the vars the case declares. All five are cleared first, so an ambient
 * value (a developer's `.env.local` loaded into the shell) can't make an "unset" case pass.
 */
function withEnvironment(values: Partial<Record<string, string>>): void {
  process.env = withoutInstapaper(originalEnvironment);
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) process.env[name] = value;
  }
}

describe('getInstapaperConfig', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('reads the four credentials and defaults the API to Instapaper itself', () => {
    withEnvironment(CONFIGURED);

    expect(getInstapaperConfig()).toEqual({
      apiUrl: 'https://www.instapaper.com',
      credentials: { consumerKey: 'ck', consumerSecret: 'cs', token: 'tk', tokenSecret: 'ts' },
    });
    expect(DEFAULT_INSTAPAPER_API_URL).toBe('https://www.instapaper.com');
  });

  it('takes an overridden API URL, without a trailing slash', () => {
    withEnvironment({ ...CONFIGURED, INSTAPAPER_API_URL: 'http://localhost:54331/' });
    expect(getInstapaperConfig()?.apiUrl).toBe('http://localhost:54331');
  });

  it.each(CREDENTIAL_VARS)('is null with %s unset', (name) => {
    withEnvironment({ ...CONFIGURED, [name]: undefined });
    expect(getInstapaperConfig()).toBeNull();
  });

  it.each(CREDENTIAL_VARS)('is null with %s blank', (name) => {
    withEnvironment({ ...CONFIGURED, [name]: ' '.repeat(3) });
    expect(getInstapaperConfig()).toBeNull();
  });

  it('is null with nothing set at all — the Work instance and local dev', () => {
    withEnvironment({});
    expect(getInstapaperConfig()).toBeNull();
  });
});
