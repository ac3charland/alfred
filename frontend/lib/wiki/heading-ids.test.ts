import { headingAnchorEntries, headingAnchors, remarkHeadingIds, slugHeading } from './heading-ids';

describe("slugHeading — GitHub's slug for one heading", () => {
  it.each([
    ['Where the sources disagree', 'where-the-sources-disagree'],
    ['Early life', 'early-life'],
    ['What? Why! (and how)', 'what-why-and-how'],
    ['Pre-existing hyphens stay', 'pre-existing-hyphens-stay'],
    ['snake_case survives', 'snake_case-survives'],
    ['Émile & Zoë', 'émile--zoë'],
    ['Two  spaces', 'two--spaces'],
  ])('%s → %s', (text, slug) => {
    expect(slugHeading(text)).toBe(slug);
  });
});

describe("headingAnchors — the page's heading ids, computed from its raw source", () => {
  it('slugs every ATX heading in order', () => {
    expect(
      headingAnchors('# Habit stacking\n\ntext\n\n## How it works\n\n### Early life\n'),
    ).toEqual(['habit-stacking', 'how-it-works', 'early-life']);
  });

  it('numbers repeats -1, -2 …', () => {
    expect(headingAnchors('## Notes\n\n## Notes\n\n## Notes\n')).toEqual([
      'notes',
      'notes-1',
      'notes-2',
    ]);
  });

  it('skips past a repeat that collides with a heading already written that way', () => {
    expect(headingAnchors('## Notes\n\n## Notes-1\n\n## Notes\n')).toEqual([
      'notes',
      'notes-1',
      'notes-2',
    ]);
  });

  it("masks a heading's inline code out before slugging, as the wiki's lint does", () => {
    expect(headingAnchors('## The `yaml` parser\n')).toEqual(['the--parser']);
    expect(headingAnchors('## Using ``a ` b`` here\n')).toEqual(['using--here']);
  });

  it('gives a heading that is only code no id', () => {
    expect(headingAnchors('## `yaml`\n\n## After\n')).toEqual(['after']);
  });

  it('drops a closing sequence of hashes', () => {
    expect(headingAnchors('## Closed ##\n')).toEqual(['closed']);
  });

  it('gives a Setext heading no id — the wiki does not count one', () => {
    expect(headingAnchors('Setext title\n============\n\n## After\n')).toEqual(['after']);
  });

  it('ignores a heading inside a fenced block, backtick or tilde', () => {
    const body = ['```md', '## Not a heading', '```', '~~~', '# Nor this', '~~~', '## Real'].join(
      '\n',
    );
    expect(headingAnchors(body)).toEqual(['real']);
  });

  it('ignores a heading after an unclosed fence, to the end of the page', () => {
    expect(headingAnchors('## Before\n\n```\n## Inside\n')).toEqual(['before']);
  });

  it('ignores a line that only looks like a heading inside an inline code span', () => {
    expect(headingAnchors('Some `code that wraps\n## onto this line` here\n\n## Real\n')).toEqual([
      'real',
    ]);
  });

  it('needs a space after the hashes, and at most six of them', () => {
    expect(headingAnchors('#hashtag\n\n####### seven\n\n###### six\n')).toEqual(['six']);
  });

  it('ignores a heading nested in a blockquote or a list, and one indented as code', () => {
    expect(
      headingAnchors('> ## Quoted\n\n- ## Listed\n\n    ## Indented\n\n   ## Three\n'),
    ).toEqual(['three']);
  });

  it('reports the line each id belongs to', () => {
    expect(headingAnchorEntries('intro\n\n## One\n\n## Two\n')).toEqual([
      { line: 3, id: 'one' },
      { line: 5, id: 'two' },
    ]);
  });

  it('reads CRLF line endings', () => {
    expect(headingAnchors('## One\r\n\r\n## Two\r\n')).toEqual(['one', 'two']);
  });
});

interface TestNode {
  type: string;
  position?: { start: { line: number; column: number; offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
  children?: TestNode[];
}

function heading(line: number, column: number, offset: number): TestNode {
  return { type: 'heading', position: { start: { line, column, offset } }, children: [] };
}

describe('remarkHeadingIds — hands the ids to the matching heading nodes', () => {
  it("sets each ATX heading node's id and leaves a Setext one alone", () => {
    const body = '## One\n\nSetext\n======\n\n> quote\n\n## One\n';
    const one = heading(1, 1, 0);
    const setext = heading(3, 1, 8);
    const two = heading(8, 1, body.lastIndexOf('## One'));
    const tree: TestNode = {
      type: 'root',
      children: [one, setext, { type: 'blockquote', children: [] }, two],
    };

    remarkHeadingIds(body)()(tree);

    expect(one.data?.hProperties?.['id']).toBe('one');
    expect(setext.data).toBeUndefined();
    expect(two.data?.hProperties?.['id']).toBe('one-1');
  });

  it('reaches a heading nested below the root and keeps its other properties', () => {
    const body = 'x\n\n## Deep\n';
    const deep: TestNode = { ...heading(3, 1, 3), data: { hProperties: { className: 'kept' } } };
    const tree: TestNode = { type: 'root', children: [{ type: 'section', children: [deep] }] };

    remarkHeadingIds(body)()(tree);

    expect(deep.data?.hProperties).toEqual({ className: 'kept', id: 'deep' });
  });

  it('skips a heading node whose source does not start with #', () => {
    const body = '> ## Quoted\n';
    const quoted = heading(1, 3, 2);
    remarkHeadingIds(body)()({ type: 'root', children: [quoted] });
    expect(quoted.data).toBeUndefined();
  });
});
