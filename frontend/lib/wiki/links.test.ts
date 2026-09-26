import { type WikiLinkTarget, resolveWikiLink, resolveWikiSource } from './links';

/** The page the link table is written against — the same one the Worker's table uses. */
const PAGE = 'wiki/concepts/habit-stacking.md';
const REPO = 'ac3charland/knowledge';
const BLOB = `https://github.com/${REPO}/blob/main`;
const TREE = `https://github.com/${REPO}/tree/main`;

/** The snapshot the table resolves against: `not-yet.md` and `habit%20loop.md` are absent. */
const INDEX = new Set([
  'wiki/concepts/habit-stacking.md',
  'wiki/concepts/habit-loop.md',
  'wiki/entities/james-clear.md',
]);

describe('resolveWikiLink — the link-resolution table, as the reading room renders it', () => {
  // The Worker pins the same hrefs (workers/src/wiki/page.test.ts) for which ones become a
  // `links` entry; this column is what each renders as. The lead diffs the two tables.
  const table: [href: string, renders: WikiLinkTarget][] = [
    ['../entities/james-clear.md', { kind: 'page', href: '/wiki/entities/james-clear' }],
    [
      '../entities/james-clear.md#early-life',
      { kind: 'page', href: '/wiki/entities/james-clear#early-life' },
    ],
    ['habit-loop.md', { kind: 'page', href: '/wiki/concepts/habit-loop' }],
    // Literal, no URL-decoding: broken unless a page file is literally named `habit%20loop.md`.
    ['habit%20loop.md', { kind: 'broken' }],
    ['#how-it-works', { kind: 'anchor', href: '#how-it-works' }],
    // In the wiki's shape but not in the snapshot: muted, dotted, not a link.
    ['../concepts/not-yet.md', { kind: 'broken' }],
    [
      '../../raw/2026/2026-10-01-atomic-habits/excerpts-2026-10-01.md#q-after-i-pour',
      {
        kind: 'github',
        href: `${BLOB}/raw/2026/2026-10-01-atomic-habits/excerpts-2026-10-01.md#q-after-i-pour`,
      },
    ],
    [
      '../../raw/2026/2026-10-01-atomic-habits/',
      { kind: 'github', href: `${TREE}/raw/2026/2026-10-01-atomic-habits` },
    ],
    ['../../index.md', { kind: 'github', href: `${BLOB}/index.md` }],
    ['../../../elsewhere.md', { kind: 'broken' }],
    // A percent-encoded dot segment: GitHub would decode it and climb, so it goes nowhere — and
    // the Worker records no backlink for it.
    ['%2e%2e/../habit-loop.md', { kind: 'broken' }],
    // Root-relative: a path from the repo root, as GitHub renders it — never an in-app page, and
    // the Worker records no backlink for it.
    [
      '/wiki/concepts/habit-loop.md',
      { kind: 'github', href: `${BLOB}/wiki/concepts/habit-loop.md` },
    ],
    // Not a page directly inside one of the four sections, but still a file in the repo.
    ['../other/x.md', { kind: 'github', href: `${BLOB}/wiki/other/x.md` }],
    ['habit-loop.txt', { kind: 'github', href: `${BLOB}/wiki/concepts/habit-loop.txt` }],
    ['https://example.com/habits', { kind: 'external', href: 'https://example.com/habits' }],
    ['mailto:alex@example.com', { kind: 'external', href: 'mailto:alex@example.com' }],
    // `[a](<habit-loop.md>)`: the wiki reads the target literally, brackets and all (the raw-URL
    // plugin keeps them), so it names no page — never an in-app link, and no backlink either.
    ['<habit-loop.md>', { kind: 'github', href: `${BLOB}/wiki/concepts/%3Chabit-loop.md%3E` }],
  ];

  it.each(table)('%s → %j', (href, renders) => {
    expect(resolveWikiLink(href, PAGE, { index: INDEX, repo: REPO })).toEqual(renders);
  });

  it.each([
    ['habit-stacking.md#top', '#top'],
    ['habit-stacking.md', '#'],
    ['../concepts/habit-stacking.md#where-the-sources-disagree', '#where-the-sources-disagree'],
  ])('reads a link to the page itself, %s, as a same-page anchor', (href, anchor) => {
    expect(resolveWikiLink(href, PAGE, { index: INDEX, repo: REPO })).toEqual({
      kind: 'anchor',
      href: anchor,
    });
  });

  it.each(['../../%2e%2e/elsewhere.md', '../../%2E%2E/x', '%2e/habit-loop.md', '.%2e/x.md'])(
    'refuses a percent-encoded dot segment, %s, rather than let GitHub climb past the repo',
    (href) => {
      expect(resolveWikiLink(href, PAGE, { index: INDEX, repo: REPO })).toEqual({
        kind: 'broken',
      });
    },
  );

  it('resolves a non-ASCII stem and a bare percent literally', () => {
    const index = new Set([...INDEX, 'wiki/entities/café.md', 'wiki/concepts/100%-rule.md']);
    const context = { index, repo: REPO };
    expect(resolveWikiLink('../entities/café.md', PAGE, context)).toEqual({
      kind: 'page',
      href: '/wiki/entities/caf%C3%A9',
    });
    expect(resolveWikiLink('100%-rule.md', PAGE, context)).toEqual({
      kind: 'page',
      href: '/wiki/concepts/100%25-rule',
    });
  });

  it('opens a page whose file is literally named with a percent sequence', () => {
    const index = new Set([...INDEX, 'wiki/concepts/habit%20loop.md']);
    expect(resolveWikiLink('habit%20loop.md', PAGE, { index, repo: REPO })).toEqual({
      kind: 'page',
      href: '/wiki/concepts/habit%2520loop',
    });
  });

  describe('with no repo configured (the Work instance)', () => {
    it.each([
      '../../raw/2026/2026-10-01-atomic-habits/excerpts-2026-10-01.md#q-after-i-pour',
      '../../raw/2026/2026-10-01-atomic-habits/',
      '../../index.md',
    ])('renders the GitHub-bound %s as broken', (href) => {
      expect(resolveWikiLink(href, PAGE, { index: INDEX, repo: null })).toEqual({
        kind: 'broken',
      });
    });

    it('still opens in-app pages, anchors and external links', () => {
      const context = { index: INDEX, repo: null };
      expect(resolveWikiLink('habit-loop.md', PAGE, context).kind).toBe('page');
      expect(resolveWikiLink('#how-it-works', PAGE, context).kind).toBe('anchor');
      expect(resolveWikiLink('https://example.com', PAGE, context).kind).toBe('external');
    });
  });

  it('reads a root-relative href as a path from the repo root, never an in-app page', () => {
    expect(
      resolveWikiLink('/wiki/concepts/habit-loop.md', PAGE, { index: INDEX, repo: REPO }),
    ).toEqual({ kind: 'github', href: `${BLOB}/wiki/concepts/habit-loop.md` });
  });

  it('keeps a target that climbs out and back into the wiki', () => {
    expect(
      resolveWikiLink('../../wiki/./entities/james-clear.md', PAGE, { index: INDEX, repo: REPO }),
    ).toEqual({ kind: 'page', href: '/wiki/entities/james-clear' });
  });

  it('sends a wiki file that is not a snapshotted page to GitHub', () => {
    expect(resolveWikiLink('nested/deeper.md', PAGE, { index: INDEX, repo: REPO })).toEqual({
      kind: 'github',
      href: `${BLOB}/wiki/concepts/nested/deeper.md`,
    });
  });

  it.each(['', 'javascript:alert(1)', 'data:text/html,hi', '//evil.example/x'])(
    'refuses %j as broken',
    (href) => {
      expect(resolveWikiLink(href, PAGE, { index: INDEX, repo: REPO })).toEqual({
        kind: 'broken',
      });
    },
  );
});

describe('resolveWikiSource — a frontmatter source, as the Sources list renders it', () => {
  it('links a cited file to its blob with the anchor kept, labelled folder / file', () => {
    expect(
      resolveWikiSource(
        'raw/2026/2026-10-01-atomic-habits/excerpts-2026-10-01.md#q-after-i-pour',
        PAGE,
        REPO,
      ),
    ).toEqual({
      label: '2026-10-01-atomic-habits / excerpts-2026-10-01.md#q-after-i-pour',
      href: `${BLOB}/raw/2026/2026-10-01-atomic-habits/excerpts-2026-10-01.md#q-after-i-pour`,
    });
  });

  it('links a cited folder to its tree', () => {
    expect(resolveWikiSource('raw/2026/2026-10-01-atomic-habits/', PAGE, REPO)).toEqual({
      label: '2026 / 2026-10-01-atomic-habits',
      href: `${TREE}/raw/2026/2026-10-01-atomic-habits`,
    });
  });

  it('resolves a page-relative source against the page folder', () => {
    expect(
      resolveWikiSource('../../raw/2026/2026-10-03-why-habits-stick/picks.md', PAGE, REPO),
    ).toEqual({
      label: '2026-10-03-why-habits-stick / picks.md',
      href: `${BLOB}/raw/2026/2026-10-03-why-habits-stick/picks.md`,
    });
  });

  it('links a URL source as itself', () => {
    expect(resolveWikiSource('https://example.com/post', PAGE, REPO)).toEqual({
      label: 'https://example.com/post',
      href: 'https://example.com/post',
    });
  });

  it('labels a source it cannot link when there is no repo, or it escapes the repo', () => {
    expect(resolveWikiSource('raw/2026/x/notes.md', PAGE, null)).toEqual({
      label: 'x / notes.md',
      href: undefined,
    });
    expect(resolveWikiSource('../../../elsewhere.md', PAGE, REPO)).toEqual({
      label: '../../../elsewhere.md',
      href: undefined,
    });
  });
});
