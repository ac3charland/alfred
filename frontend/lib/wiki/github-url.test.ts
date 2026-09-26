import { githubBlobUrl, githubTreeUrl } from './github-url';

describe('githubBlobUrl', () => {
  it('points at the file on main', () => {
    expect(githubBlobUrl('ac3charland/knowledge', 'index.md')).toBe(
      'https://github.com/ac3charland/knowledge/blob/main/index.md',
    );
  });

  it('keeps the anchor, with or without its leading #', () => {
    const path = 'raw/2026/2026-10-01-atomic-habits/excerpts-2026-10-01.md';
    const expected = `https://github.com/ac3charland/knowledge/blob/main/${path}#q-after-i-pour`;
    expect(githubBlobUrl('ac3charland/knowledge', path, 'q-after-i-pour')).toBe(expected);
    expect(githubBlobUrl('ac3charland/knowledge', path, '#q-after-i-pour')).toBe(expected);
  });

  it('drops an empty anchor and a leading slash', () => {
    expect(githubBlobUrl('ac3charland/knowledge', '/index.md', '')).toBe(
      'https://github.com/ac3charland/knowledge/blob/main/index.md',
    );
  });

  it('encodes each path segment, keeping the slashes, so `#` and `?` stay in the path', () => {
    expect(githubBlobUrl('ac3charland/knowledge', 'raw/a#b/why?.md', 'q')).toBe(
      'https://github.com/ac3charland/knowledge/blob/main/raw/a%23b/why%3F.md#q',
    );
  });
});

describe('githubTreeUrl', () => {
  it('encodes each folder segment, keeping the slashes', () => {
    expect(githubTreeUrl('ac3charland/knowledge', 'raw/a#b/c d/')).toBe(
      'https://github.com/ac3charland/knowledge/tree/main/raw/a%23b/c%20d',
    );
  });

  it('points at the folder on main, without its trailing slash', () => {
    expect(githubTreeUrl('ac3charland/knowledge', 'raw/2026/2026-10-01-atomic-habits/')).toBe(
      'https://github.com/ac3charland/knowledge/tree/main/raw/2026/2026-10-01-atomic-habits',
    );
  });

  it('points at the repo root for an empty path', () => {
    expect(githubTreeUrl('ac3charland/knowledge', '')).toBe(
      'https://github.com/ac3charland/knowledge/tree/main',
    );
  });
});
