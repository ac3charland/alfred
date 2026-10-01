import { rmSync } from 'node:fs';

import { BUILDER_PATH, gitIn } from '../git.ts';
import { captureStart, normalizeRepo, repoFromRemote } from './repo.ts';
import { makeRepo, scrubGitEnv } from './test-support.ts';
import type { TempRepo } from './test-support.ts';

beforeAll(scrubGitEnv);

describe('normalizeRepo', () => {
  it.each([
    ['https://github.com/ac3charland/alfred', 'ac3charland/alfred'],
    ['https://github.com/ac3charland/alfred.git', 'ac3charland/alfred'],
    ['https://github.com/ac3charland/alfred.git/', 'ac3charland/alfred'],
    ['git@github.com:ac3charland/alfred.git', 'ac3charland/alfred'],
    ['ssh://git@github.com/ac3charland/alfred.git', 'ac3charland/alfred'],
    ['http://local_proxy@127.0.0.1:1234/git/ac3charland/alfred', 'ac3charland/alfred'],
    ['http://local_proxy@127.0.0.1:1234/git/ac3charland/alfred.git\n', 'ac3charland/alfred'],
    ['https://github.com/some-org/my.repo_name', 'some-org/my.repo_name'],
  ])('%s -> %s', (remote, expected) => {
    expect(normalizeRepo(remote)).toBe(expected);
  });

  it.each(['', 'alfred', 'https://github.com/', 'https://github.com/only', '/'])(
    'is null for %j',
    (remote) => {
      expect(normalizeRepo(remote)).toBeNull();
    },
  );
});

describe('captureStart', () => {
  const repos: TempRepo[] = [];
  afterAll(() => {
    for (const repo of repos) rmSync(repo.dir, { recursive: true, force: true });
  });

  it('is HEAD, the last commit that changed the builders, and the owner/name of origin', () => {
    const repo = makeRepo(
      [{ [BUILDER_PATH]: 'v1\n' }, { [BUILDER_PATH]: 'v2\n' }, { 'README.md': 'later\n' }],
      'git@github.com:ac3charland/alfred.git',
    );
    repos.push(repo);
    const builder = gitIn(repo.dir)(['rev-parse', 'HEAD~1']).stdout.trim();
    expect(captureStart(gitIn(repo.dir))).toEqual({
      repo: 'ac3charland/alfred',
      base_sha: repo.head,
      builder_sha: builder,
    });
  });

  it('has no builder sha when the history never touched the file', () => {
    const repo = makeRepo([{ 'README.md': 'x\n' }], 'https://github.com/o/n');
    repos.push(repo);
    expect(captureStart(gitIn(repo.dir))).toEqual({
      repo: 'o/n',
      base_sha: repo.head,
      builder_sha: null,
    });
  });

  it('has no repo without an origin', () => {
    const repo = makeRepo([{ 'README.md': 'x\n' }]);
    repos.push(repo);
    expect(repoFromRemote(gitIn(repo.dir))).toBeNull();
    expect(captureStart(gitIn(repo.dir)).repo).toBeNull();
  });
});
