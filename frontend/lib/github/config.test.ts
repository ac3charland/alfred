import { type MeasuredProject, getGithubRepoConfig, getPrRatioConfig } from './config';

/** The two vars this feature still reads. `undefined` means "unset on this deployment". */
interface GithubEnvironment {
  GITHUB_TOKEN?: string | undefined;
  PR_RATIO_AUTHORS?: string | undefined;
}

const CONFIGURED: GithubEnvironment = {
  GITHUB_TOKEN: 'ghp_test',
  PR_RATIO_AUTHORS: 'ac3charland',
};

const REALPLAY: MeasuredProject = {
  name: 'RealPlay',
  repo_owner: 'ac3charland',
  repo_name: 'realplay',
};
const ALFRED: MeasuredProject = { name: 'Alfred', repo_owner: 'ac3charland', repo_name: 'alfred' };

/** Two project rows, oldest first — the order the routes read them in. */
const PROJECTS: MeasuredProject[] = [REALPLAY, ALFRED];

const originalEnvironment = { ...process.env };

/**
 * Give this feature exactly the vars the case declares, and nothing else. Both are cleared
 * first because the ambient environment may well carry a `GITHUB_TOKEN` of its own (a dev
 * machine, CI) — an "unset" case would otherwise inherit it and assert nothing.
 */
function withEnvironment(values: GithubEnvironment): void {
  process.env = { ...originalEnvironment };
  delete process.env.GITHUB_TOKEN;
  delete process.env.PR_RATIO_AUTHORS;

  if (values.GITHUB_TOKEN !== undefined) process.env.GITHUB_TOKEN = values.GITHUB_TOKEN;
  if (values.PR_RATIO_AUTHORS !== undefined) process.env.PR_RATIO_AUTHORS = values.PR_RATIO_AUTHORS;
}

describe('getPrRatioConfig', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('measures every given project, in the given order, labelled by project name', () => {
    withEnvironment(CONFIGURED);

    expect(getPrRatioConfig(PROJECTS)).toEqual({
      token: 'ghp_test',
      authors: ['ac3charland'],
      repos: [
        { owner: 'ac3charland', name: 'realplay', label: 'RealPlay' },
        { owner: 'ac3charland', name: 'alfred', label: 'Alfred' },
      ],
    });
  });

  it('keeps the caller’s order rather than sorting — it is the bar’s left-to-right order', () => {
    withEnvironment(CONFIGURED);

    expect(getPrRatioConfig([ALFRED, REALPLAY])?.repos.map((repo) => repo.label)).toEqual([
      'Alfred',
      'RealPlay',
    ]);
  });

  it('is unconfigured with a single project — a one-repo ratio is meaningless', () => {
    withEnvironment(CONFIGURED);

    expect(getPrRatioConfig([REALPLAY])).toBeUndefined();
  });

  it('is unconfigured with no projects at all', () => {
    withEnvironment(CONFIGURED);

    expect(getPrRatioConfig([])).toBeUndefined();
  });

  it('is unconfigured when the token is missing', () => {
    withEnvironment({ ...CONFIGURED, GITHUB_TOKEN: undefined });

    expect(getPrRatioConfig(PROJECTS)).toBeUndefined();
  });

  it('treats a blank token as unset', () => {
    withEnvironment({ ...CONFIGURED, GITHUB_TOKEN: ' '.repeat(3) });

    expect(getPrRatioConfig(PROJECTS)).toBeUndefined();
  });

  it('trims whitespace around author logins', () => {
    withEnvironment({ ...CONFIGURED, PR_RATIO_AUTHORS: ' ac3charland , claude-bot ' });

    expect(getPrRatioConfig(PROJECTS)?.authors).toEqual(['ac3charland', 'claude-bot']);
  });

  it('yields no authors when the allowlist is unset', () => {
    withEnvironment({ ...CONFIGURED, PR_RATIO_AUTHORS: undefined });

    expect(getPrRatioConfig(PROJECTS)?.authors).toEqual([]);
  });

  it('yields no authors when the allowlist is blank', () => {
    withEnvironment({ ...CONFIGURED, PR_RATIO_AUTHORS: ' , ' });

    expect(getPrRatioConfig(PROJECTS)?.authors).toEqual([]);
  });

  it('ignores a leftover PR_RATIO_REPOS — the projects are the only repo list', () => {
    withEnvironment(CONFIGURED);
    process.env['PR_RATIO_REPOS'] = 'someone/else:Elsewhere,another/repo:Another';

    expect(getPrRatioConfig(PROJECTS)?.repos.map((repo) => repo.label)).toEqual([
      'RealPlay',
      'Alfred',
    ]);
    // Nor does it rescue a deployment whose projects alone don't configure the ratio.
    expect(getPrRatioConfig([REALPLAY])).toBeUndefined();
  });
});

describe('getGithubRepoConfig vs getPrRatioConfig', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('configures the velocity chart from a single project, but not the ratio', () => {
    withEnvironment(CONFIGURED);

    // One repo is a perfectly good velocity series; it is not a split.
    expect(getGithubRepoConfig([REALPLAY])?.repos).toEqual([
      { owner: 'ac3charland', name: 'realplay', label: 'RealPlay' },
    ]);
    expect(getPrRatioConfig([REALPLAY])).toBeUndefined();
  });

  it('configures both once a second project exists', () => {
    withEnvironment(CONFIGURED);

    expect(getGithubRepoConfig(PROJECTS)?.repos).toHaveLength(2);
    expect(getPrRatioConfig(PROJECTS)?.repos).toHaveLength(2);
  });

  it('configures neither with no projects', () => {
    withEnvironment(CONFIGURED);

    expect(getGithubRepoConfig([])).toBeUndefined();
    expect(getPrRatioConfig([])).toBeUndefined();
  });

  it('configures neither without a token, however many projects exist', () => {
    withEnvironment({ ...CONFIGURED, GITHUB_TOKEN: undefined });

    expect(getGithubRepoConfig(PROJECTS)).toBeUndefined();
    expect(getPrRatioConfig(PROJECTS)).toBeUndefined();
  });

  it('hands both widgets the same authors, so the page cannot disagree with itself', () => {
    withEnvironment(CONFIGURED);

    expect(getGithubRepoConfig(PROJECTS)?.authors).toStrictEqual(
      getPrRatioConfig(PROJECTS)?.authors,
    );
  });
});
