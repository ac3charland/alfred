import { getPrRatioConfig } from './config';

/** The three vars this feature reads. `undefined` means "unset on this deployment". */
interface PrRatioEnvironment {
  GITHUB_TOKEN?: string | undefined;
  PR_RATIO_REPOS?: string | undefined;
  PR_RATIO_AUTHORS?: string | undefined;
}

const CONFIGURED: PrRatioEnvironment = {
  GITHUB_TOKEN: 'ghp_test',
  PR_RATIO_REPOS: 'ac3charland/realplay:RealPlay,ac3charland/alfred:Alfred',
  PR_RATIO_AUTHORS: 'ac3charland',
};

const originalEnvironment = { ...process.env };

/**
 * Give this feature exactly the vars the case declares, and nothing else. The three are
 * cleared first because the ambient environment may well carry a `GITHUB_TOKEN` of its own (a
 * dev machine, CI) — an "unset" case would otherwise inherit it and assert nothing.
 */
function withEnvironment(values: PrRatioEnvironment): void {
  process.env = { ...originalEnvironment };
  delete process.env.GITHUB_TOKEN;
  delete process.env.PR_RATIO_REPOS;
  delete process.env.PR_RATIO_AUTHORS;

  if (values.GITHUB_TOKEN !== undefined) process.env.GITHUB_TOKEN = values.GITHUB_TOKEN;
  if (values.PR_RATIO_REPOS !== undefined) process.env.PR_RATIO_REPOS = values.PR_RATIO_REPOS;
  if (values.PR_RATIO_AUTHORS !== undefined) process.env.PR_RATIO_AUTHORS = values.PR_RATIO_AUTHORS;
}

describe('getPrRatioConfig', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('parses repos with their display labels, in configured order', () => {
    withEnvironment(CONFIGURED);

    expect(getPrRatioConfig()).toEqual({
      token: 'ghp_test',
      authors: ['ac3charland'],
      repos: [
        { owner: 'ac3charland', name: 'realplay', label: 'RealPlay' },
        { owner: 'ac3charland', name: 'alfred', label: 'Alfred' },
      ],
    });
  });

  it('falls the label back to the repo name when the :Label suffix is omitted', () => {
    withEnvironment({ ...CONFIGURED, PR_RATIO_REPOS: 'ac3charland/realplay,ac3charland/alfred' });

    expect(getPrRatioConfig()?.repos).toEqual([
      { owner: 'ac3charland', name: 'realplay', label: 'realplay' },
      { owner: 'ac3charland', name: 'alfred', label: 'alfred' },
    ]);
  });

  it('trims whitespace around entries, labels and author logins', () => {
    withEnvironment({
      ...CONFIGURED,
      PR_RATIO_REPOS: '  ac3charland/realplay : RealPlay , ac3charland/alfred : Alfred ',
      PR_RATIO_AUTHORS: ' ac3charland , claude-bot ',
    });

    const config = getPrRatioConfig();
    expect(config?.repos).toEqual([
      { owner: 'ac3charland', name: 'realplay', label: 'RealPlay' },
      { owner: 'ac3charland', name: 'alfred', label: 'Alfred' },
    ]);
    expect(config?.authors).toEqual(['ac3charland', 'claude-bot']);
  });

  it('skips a malformed entry rather than failing the whole config', () => {
    withEnvironment({
      ...CONFIGURED,
      PR_RATIO_REPOS: 'not-a-repo,ac3charland/realplay:RealPlay,,ac3charland/alfred:Alfred',
    });

    expect(getPrRatioConfig()?.repos).toEqual([
      { owner: 'ac3charland', name: 'realplay', label: 'RealPlay' },
      { owner: 'ac3charland', name: 'alfred', label: 'Alfred' },
    ]);
  });

  it('is unconfigured when fewer than two repos survive parsing — a one-repo ratio is meaningless', () => {
    withEnvironment({ ...CONFIGURED, PR_RATIO_REPOS: 'ac3charland/alfred:Alfred' });

    expect(getPrRatioConfig()).toBeUndefined();
  });

  it('is unconfigured when the repo list is missing entirely', () => {
    withEnvironment({ ...CONFIGURED, PR_RATIO_REPOS: undefined });

    expect(getPrRatioConfig()).toBeUndefined();
  });

  it('is unconfigured when the token is missing', () => {
    withEnvironment({ ...CONFIGURED, GITHUB_TOKEN: undefined });

    expect(getPrRatioConfig()).toBeUndefined();
  });

  it('treats a blank value as unset', () => {
    withEnvironment({ ...CONFIGURED, GITHUB_TOKEN: ' '.repeat(3) });

    expect(getPrRatioConfig()).toBeUndefined();
  });

  it('yields no authors when the allowlist is unset', () => {
    withEnvironment({ ...CONFIGURED, PR_RATIO_AUTHORS: undefined });

    expect(getPrRatioConfig()?.authors).toEqual([]);
  });

  it('yields no authors when the allowlist is blank', () => {
    withEnvironment({ ...CONFIGURED, PR_RATIO_AUTHORS: ' , ' });

    expect(getPrRatioConfig()?.authors).toEqual([]);
  });
});
