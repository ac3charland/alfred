import { parseGithubRepo } from './github';

describe('parseGithubRepo', () => {
  it('parses a canonical https repo URL', () => {
    expect(parseGithubRepo('https://github.com/ac3charland/alfred')).toEqual({
      owner: 'ac3charland',
      name: 'alfred',
    });
  });

  it('tolerates a trailing slash', () => {
    expect(parseGithubRepo('https://github.com/ac3charland/alfred/')).toEqual({
      owner: 'ac3charland',
      name: 'alfred',
    });
  });

  it('strips a trailing .git', () => {
    expect(parseGithubRepo('https://github.com/ac3charland/alfred.git')).toEqual({
      owner: 'ac3charland',
      name: 'alfred',
    });
  });

  it('ignores extra path segments after the repo', () => {
    expect(parseGithubRepo('https://github.com/ac3charland/alfred/tree/main')).toEqual({
      owner: 'ac3charland',
      name: 'alfred',
    });
  });

  it('accepts a www. host and http scheme', () => {
    expect(parseGithubRepo('https://www.github.com/ac3charland/alfred')).toEqual({
      owner: 'ac3charland',
      name: 'alfred',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseGithubRepo('  https://github.com/ac3charland/alfred  ')).toEqual({
      owner: 'ac3charland',
      name: 'alfred',
    });
  });

  it('returns null for a non-github host', () => {
    expect(parseGithubRepo('https://gitlab.com/ac3charland/alfred')).toBeNull();
  });

  it('returns null for a github URL missing the repo segment', () => {
    expect(parseGithubRepo('https://github.com/ac3charland')).toBeNull();
  });

  it('returns null for a non-URL string', () => {
    expect(parseGithubRepo('not a url')).toBeNull();
  });

  it('only strips a .git suffix at the end of the repo name (anchored)', () => {
    // An unanchored `\.git` would chew ".git" out of the middle; this name keeps it.
    expect(parseGithubRepo('https://github.com/ac3charland/alfred.gitx')).toEqual({
      owner: 'ac3charland',
      name: 'alfred.gitx',
    });
  });

  it('returns null when the repo segment is just ".git" (empty after stripping)', () => {
    // rawName ".git" → name "" → the empty-name guard must reject it, not return an empty name.
    expect(parseGithubRepo('https://github.com/ac3charland/.git')).toBeNull();
  });
});
