import { extractLinks, parsePage, resolveLink, sortedBy } from './page';

/** The page the link-resolution table below is written against. */
const PAGE = 'wiki/concepts/habit-stacking.md';

describe('resolveLink — the link-resolution table: which hrefs become a `links` entry', () => {
  // The frontend's link renderer (lib/wiki/links.ts) pins the same hrefs, so a backlink here and
  // an in-app link there always name the same page.
  // `undefined` is "(none)": the href is not a wiki page link and never reaches `links`.
  const table: [href: string, entry: string | undefined][] = [
    ['../entities/james-clear.md', 'wiki/entities/james-clear.md'],
    ['../entities/james-clear.md#early-life', 'wiki/entities/james-clear.md'],
    ['habit-loop.md', 'wiki/concepts/habit-loop.md'],
    // Literal: no URL-decoding, exactly like the wiki's own lint.
    ['habit%20loop.md', 'wiki/concepts/habit%20loop.md'],
    ['#how-it-works', undefined],
    // Missing from the snapshot, but kept: a backlink doesn't care whether its target exists.
    ['../concepts/not-yet.md', 'wiki/concepts/not-yet.md'],
    ['../../raw/2026/2026-10-01-atomic-habits/excerpts-2026-10-01.md#q-1', undefined],
    ['../../raw/2026/2026-10-01-atomic-habits/', undefined],
    ['../../index.md', undefined],
    ['../../../elsewhere.md', undefined],
    ['https://example.com/habits', undefined],
    ['mailto:alex@example.com', undefined],
  ];

  it.each(table)('%s → %s', (href, entry) => {
    expect(resolveLink(PAGE, href)).toBe(entry);
  });

  it('never resolves a root-relative href — only folder-relative ones are wiki links', () => {
    expect(resolveLink(PAGE, '/wiki/concepts/habit-loop.md')).toBeUndefined();
  });

  it('keeps a target that climbs out and back into the wiki', () => {
    expect(resolveLink(PAGE, '../../wiki/./sources/atomic-habits.md')).toBe(
      'wiki/sources/atomic-habits.md',
    );
  });

  it('refuses a path that is not a page directly inside one of the four sections', () => {
    expect(resolveLink(PAGE, '../other/x.md')).toBeUndefined();
    expect(resolveLink(PAGE, 'nested/deeper.md')).toBeUndefined();
    expect(resolveLink(PAGE, 'habit-loop.txt')).toBeUndefined();
  });
});

describe('extractLinks', () => {
  it('reads an image as NOT a link — an embed names a file, not a page', () => {
    expect(extractLinks('![a figure](../../raw/2026/x/assets/fig.png)')).toEqual([]);
    expect(extractLinks('![alt](../entities/james-clear.md)')).toEqual([]);
  });

  it('reads every markdown link target in order, titles and angle brackets stripped', () => {
    expect(
      extractLinks('[a](one.md) then [b](<two.md>) and [c](three.md "A title") [](four.md)'),
    ).toEqual(['one.md', 'two.md', 'three.md', 'four.md']);
  });

  it('masks a fenced code block, backtick or tilde, so a link inside one is not a link', () => {
    const text = [
      'Before [real](real.md).',
      '```md',
      '[fenced](fenced.md)',
      '```',
      '~~~',
      '[tilde](tilde.md)',
      '~~~',
      'After [also](also.md).',
    ].join('\n');
    expect(extractLinks(text)).toEqual(['real.md', 'also.md']);
  });

  it('masks inline code, so a link written as code is not a link', () => {
    expect(extractLinks('Write `[x](inline.md)` or ``[y](double.md)``, see [z](z.md).')).toEqual([
      'z.md',
    ]);
  });

  it('never lets an inline code span cross a blank line, as CommonMark does', () => {
    // Two stray backticks in different paragraphs are not a code span, so the link between
    // them is a link.
    expect(extractLinks('Press ` key.\n\nSee [loop](habit-loop.md).\n\nThen ` again.')).toEqual([
      'habit-loop.md',
    ]);
  });

  it('still masks an inline code span that wraps onto the next line', () => {
    expect(extractLinks('Write `[x](a.md)\n[y](b.md)` then [z](z.md).')).toEqual(['z.md']);
  });

  it('masks an unclosed fence to the end of the page, as CommonMark does', () => {
    expect(extractLinks('[a](a.md)\n```\n[b](b.md)\n')).toEqual(['a.md']);
  });
});

/** A page with every frontmatter field present and well-formed. */
const GOOD = [
  '---',
  'title: Habit stacking',
  'summary: Pair a new habit with a current one.',
  'tags: [habits, "", behaviour, 3]',
  'sources:',
  '  - ../sources/atomic-habits.md',
  '  - "  "',
  'created: 2026-10-01',
  'updated: 2026-10-02',
  '---',
  '# Habit stacking',
  '',
  'See [James Clear](../entities/james-clear.md#early-life) and [the loop](habit-loop.md).',
  'Also [James again](../entities/james-clear.md), [myself](habit-stacking.md#top),',
  '[a raw quote](../../raw/2026/q.md#q-1) and [a site](https://example.com).',
  '',
].join('\n');

describe('parsePage', () => {
  it('parses a well-formed page into its row fields', () => {
    expect(parsePage(PAGE, GOOD)).toEqual({
      path: PAGE,
      section: 'concepts',
      title: 'Habit stacking',
      summary: 'Pair a new habit with a current one.',
      tags: ['habits', 'behaviour'],
      sources: ['../sources/atomic-habits.md'],
      created: '2026-10-01',
      updated: '2026-10-02',
      // Deduped, the page itself dropped, raw/ and external dropped, sorted.
      links: ['wiki/concepts/habit-loop.md', 'wiki/entities/james-clear.md'],
      body: [
        '# Habit stacking',
        '',
        'See [James Clear](../entities/james-clear.md#early-life) and [the loop](habit-loop.md).',
        'Also [James again](../entities/james-clear.md), [myself](habit-stacking.md#top),',
        '[a raw quote](../../raw/2026/q.md#q-1) and [a site](https://example.com).',
        '',
      ].join('\n'),
      parse_error: undefined,
    });
  });

  it('takes the section from the path', () => {
    expect(parsePage('wiki/questions/why.md', 'x').section).toBe('questions');
  });

  it('normalises CRLF before splitting the frontmatter', () => {
    const page = parsePage(PAGE, '---\r\ntitle: Windows\r\n---\r\nBody line\r\n');
    expect(page.title).toBe('Windows');
    expect(page.body).toBe('Body line\n');
    expect(page.parse_error).toBeUndefined();
  });

  it('reads a page with no frontmatter as all body, titled by its file stem', () => {
    const page = parsePage(PAGE, '# Just a body\n');
    expect(page).toMatchObject({
      title: 'habit-stacking',
      summary: '',
      tags: [],
      sources: [],
      created: undefined,
      updated: undefined,
      body: '# Just a body\n',
      parse_error: undefined,
    });
  });

  it('reads an unclosed frontmatter fence as body, not as frontmatter', () => {
    const page = parsePage(PAGE, '---\ntitle: Never closed\n');
    expect(page.title).toBe('habit-stacking');
    expect(page.body).toBe('---\ntitle: Never closed\n');
  });

  it('accepts an empty frontmatter block', () => {
    const page = parsePage(PAGE, '---\n---\nbody');
    expect(page.title).toBe('habit-stacking');
    expect(page.body).toBe('body');
    expect(page.parse_error).toBeUndefined();
  });

  it('sets parse_error on invalid YAML and keeps the WHOLE text as the body', () => {
    const text = '---\ntitle: [unclosed\n---\nSee [loop](habit-loop.md).\n';
    const page = parsePage(PAGE, text);
    expect(page.parse_error).toEqual(expect.stringContaining('frontmatter'));
    expect(page.body).toBe(text);
    expect(page.title).toBe('habit-stacking');
    expect(page.summary).toBe('');
    // Links are still read from what is there, so a broken page still feeds backlinks.
    expect(page.links).toEqual(['wiki/concepts/habit-loop.md']);
  });

  it('sets parse_error when the frontmatter is YAML but not a mapping', () => {
    const page = parsePage(PAGE, '---\n- just\n- a list\n---\nbody');
    expect(page.parse_error).toEqual(expect.stringContaining('mapping'));
    expect(page.body).toBe('---\n- just\n- a list\n---\nbody');
  });

  it.each([
    ['missing', 'summary: s'],
    ['blank', 'title: "   "'],
    ['not a string', 'title: 1984'],
  ])('falls back to the file stem when the title is %s', (_label, line) => {
    expect(parsePage(PAGE, `---\n${line}\n---\nbody`).title).toBe('habit-stacking');
  });

  it('reads a non-string summary, and non-list tags or sources, as empty', () => {
    const page = parsePage(PAGE, '---\nsummary: [a]\ntags: habits\nsources: 7\n---\n');
    expect(page.summary).toBe('');
    expect(page.tags).toEqual([]);
    expect(page.sources).toEqual([]);
  });

  it.each([
    ['2026-02-30', 'not a real day'],
    ['2026-13-01', 'not a real month'],
    ['2026-1-5', 'not YYYY-MM-DD'],
    ['"October 1"', 'prose'],
    ['20261001', 'a number'],
    ['2026-10-01T09:00:00Z', 'a timestamp'],
  ])('drops a created/updated of %s (%s)', (value) => {
    const page = parsePage(PAGE, `---\ncreated: ${value}\nupdated: ${value}\n---\n`);
    expect(page.created).toBeUndefined();
    expect(page.updated).toBeUndefined();
  });

  it('drops year 0000, which a JS Date round-trips but Postgres refuses as a date', () => {
    const page = parsePage(PAGE, '---\ncreated: 0000-01-01\nupdated: 0001-01-01\n---\n');
    expect(page.created).toBeUndefined();
    expect(page.updated).toBe('0001-01-01');
  });

  it('strips NUL from every stored text field, since Postgres refuses it in text (22P05)', () => {
    // A raw NUL in the body, and YAML's "\0" escape producing one inside frontmatter strings.
    const text = [
      '---',
      String.raw`title: "Ha\0bit"`,
      String.raw`summary: "Sum\0mary"`,
      String.raw`tags: ["ta\0g", "\0"]`,
      String.raw`sources: ["../sources/a\0.md"]`,
      '---',
      'Bo\u0000dy [l](habit-loop.md)\u0000',
    ].join('\n');
    const page = parsePage(PAGE, text);
    expect(page).toMatchObject({
      title: 'Habit',
      summary: 'Summary',
      tags: ['tag'],
      sources: ['../sources/a.md'],
      body: 'Body [l](habit-loop.md)',
      links: ['wiki/concepts/habit-loop.md'],
      parse_error: undefined,
    });
  });

  it('strips NUL from the body kept by a page whose frontmatter failed to parse', () => {
    const page = parsePage(PAGE, '---\ntitle: [unclosed\n---\nx\u0000y');
    expect(page.parse_error).toBeDefined();
    expect(page.body).toBe('---\ntitle: [unclosed\n---\nxy');
  });

  it('keeps a leap day, which is a real date', () => {
    expect(parsePage(PAGE, '---\ncreated: 2028-02-29\n---\n').created).toBe('2028-02-29');
  });

  it('never counts a link inside code toward links', () => {
    const text = '---\ntitle: T\n---\n`[x](habit-loop.md)`\n```\n[y](../entities/y.md)\n```\n';
    expect(parsePage(PAGE, text).links).toEqual([]);
  });
});

describe('sortedBy', () => {
  it('orders by plain code unit, keeps ties in arrival order, and leaves the input alone', () => {
    const input = [
      { key: 'b', n: 1 },
      { key: 'B', n: 2 },
      { key: 'a', n: 3 },
      { key: 'b', n: 4 },
      { key: 'a-1', n: 5 },
    ];
    expect(sortedBy(input, (item) => item.key).map((item) => item.n)).toEqual([2, 3, 5, 1, 4]);
    expect(input.map((item) => item.n)).toEqual([1, 2, 3, 4, 5]);
  });
});
