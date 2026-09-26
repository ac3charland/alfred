import {
  DEFAULT_WIKI_API_URL,
  getWikiClientConfig,
  getWikiConfig,
  getWikiRepoName,
} from './config';

// `import 'server-only'` throws outside a Server Component context; neutralise it under Jest.
jest.mock('server-only', () => ({}));

/** The three vars the writer reads. `undefined` means "unset on this deployment". */
interface WikiEnvironment {
  WIKI_GITHUB_TOKEN?: string | undefined;
  WIKI_REPO?: string | undefined;
  WIKI_GITHUB_API_URL?: string | undefined;
}

const originalEnvironment = { ...process.env };

/** Give the writer exactly the vars the case declares, and nothing else. */
function withEnvironment(values: WikiEnvironment): void {
  process.env = { ...originalEnvironment };
  delete process.env.WIKI_GITHUB_TOKEN;
  delete process.env.WIKI_REPO;
  delete process.env.WIKI_GITHUB_API_URL;
  if (values.WIKI_GITHUB_TOKEN !== undefined) {
    process.env.WIKI_GITHUB_TOKEN = values.WIKI_GITHUB_TOKEN;
  }
  if (values.WIKI_REPO !== undefined) process.env.WIKI_REPO = values.WIKI_REPO;
  if (values.WIKI_GITHUB_API_URL !== undefined) {
    process.env.WIKI_GITHUB_API_URL = values.WIKI_GITHUB_API_URL;
  }
}

describe('getWikiConfig', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('parses the repo into owner and name and defaults the API origin', () => {
    withEnvironment({ WIKI_GITHUB_TOKEN: 'github_pat_test', WIKI_REPO: 'ac3charland/knowledge' });

    expect(getWikiConfig()).toEqual({
      owner: 'ac3charland',
      name: 'knowledge',
      token: 'github_pat_test',
      apiUrl: DEFAULT_WIKI_API_URL,
    });
  });

  it('takes the harness API origin when set, without a trailing slash', () => {
    withEnvironment({
      WIKI_GITHUB_TOKEN: 't',
      WIKI_REPO: 'ac3charland/knowledge',
      WIKI_GITHUB_API_URL: 'http://localhost:54331/__mock__/github/',
    });

    expect(getWikiConfig()?.apiUrl).toBe('http://localhost:54331/__mock__/github');
  });

  it('is unconfigured without a token — the Work instance', () => {
    withEnvironment({ WIKI_REPO: 'ac3charland/knowledge' });
    expect(getWikiConfig()).toBeUndefined();
  });

  it('is unconfigured without a repo, or with one that is not owner/name', () => {
    withEnvironment({ WIKI_GITHUB_TOKEN: 't' });
    expect(getWikiConfig()).toBeUndefined();

    withEnvironment({ WIKI_GITHUB_TOKEN: 't', WIKI_REPO: 'knowledge' });
    expect(getWikiConfig()).toBeUndefined();

    withEnvironment({ WIKI_GITHUB_TOKEN: 't', WIKI_REPO: 'a/b/c' });
    expect(getWikiConfig()).toBeUndefined();
  });

  it('is unconfigured when the owner or the name is "." or ".." — a path segment, not a name', () => {
    withEnvironment({ WIKI_GITHUB_TOKEN: 't', WIKI_REPO: './knowledge' });
    expect(getWikiConfig()).toBeUndefined();

    withEnvironment({ WIKI_GITHUB_TOKEN: 't', WIKI_REPO: '../knowledge' });
    expect(getWikiConfig()).toBeUndefined();

    withEnvironment({ WIKI_GITHUB_TOKEN: 't', WIKI_REPO: 'ac3charland/.' });
    expect(getWikiConfig()).toBeUndefined();

    withEnvironment({ WIKI_GITHUB_TOKEN: 't', WIKI_REPO: 'ac3charland/..' });
    expect(getWikiConfig()).toBeUndefined();
  });

  it('treats a blank token as unset', () => {
    withEnvironment({ WIKI_GITHUB_TOKEN: ' '.repeat(3), WIKI_REPO: 'ac3charland/knowledge' });
    expect(getWikiConfig()).toBeUndefined();
  });
});

describe('getWikiClientConfig', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  /** The exact key set every case below pins — a `token` field here would ride to the browser. */
  const CLIENT_KEYS = ['repo', 'writable'];

  it('is writable with a repo name when both the token and repo are set', () => {
    withEnvironment({ WIKI_GITHUB_TOKEN: 't', WIKI_REPO: 'ac3charland/knowledge' });

    const config = getWikiClientConfig();

    expect(new Set(Object.keys(config))).toStrictEqual(new Set(CLIENT_KEYS));
    expect(config).toEqual({ repo: 'ac3charland/knowledge', writable: true });
  });

  it('names the repo but is not writable with a repo and no token — the Work instance', () => {
    withEnvironment({ WIKI_REPO: 'ac3charland/knowledge' });

    const config = getWikiClientConfig();

    expect(new Set(Object.keys(config))).toStrictEqual(new Set(CLIENT_KEYS));
    expect(config).toEqual({ repo: 'ac3charland/knowledge', writable: false });
  });

  it('is unwritable with no repo name when neither is set', () => {
    withEnvironment({});

    const config = getWikiClientConfig();

    expect(new Set(Object.keys(config))).toStrictEqual(new Set(CLIENT_KEYS));
    expect(config).toEqual({ repo: null, writable: false });
  });
});

describe('getWikiRepoName', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('names the repo whether or not a token is set — links need it, writes do not', () => {
    withEnvironment({ WIKI_REPO: ' ac3charland/knowledge ' });
    expect(getWikiRepoName()).toBe('ac3charland/knowledge');
  });

  it('is null when the repo is unset or malformed', () => {
    withEnvironment({});
    expect(getWikiRepoName()).toBeNull();
    withEnvironment({ WIKI_REPO: 'nope' });
    expect(getWikiRepoName()).toBeNull();
  });
});
