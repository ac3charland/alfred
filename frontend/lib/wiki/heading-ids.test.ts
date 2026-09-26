import { headingAnchorEntries, headingAnchors, remarkHeadingIds, slugHeading } from './heading-ids';

describe("slugHeading — the wiki's slug for one heading", () => {
  it.each([
    ['Where the sources disagree', 'where-the-sources-disagree'],
    ['Early life', 'early-life'],
    ['What? Why! (and how)', 'what-why-and-how'],
    ['Pre-existing hyphens stay', 'pre-existing-hyphens-stay'],
    ['snake_case survives', 'snake_case-survives'],
    ['Émile & Zoë', 'émile--zoë'],
    ['Two  spaces', 'two--spaces'],
    // The wiki's own table (scripts/lib/wiki.test.ts).
    ['Emotional Regulation!', 'emotional-regulation'],
    ['Q: What now?', 'q-what-now'],
    [
      'q-by-stabilizing-the-parents-gottman-and-3da3',
      'q-by-stabilizing-the-parents-gottman-and-3da3',
    ],
    ['Café Life', 'café-life'],
    // Combining marks and connector punctuation are dropped, not kept as GitHub keeps them.
    ['Cafe\u0301', 'cafe'],
    ['हिन्दी', 'हनद'],
    ['a＿b', 'ab'],
    ['a‿b', 'ab'],
    ['!!!', ''],
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

  it('counts one suffix per slug, never checking it against a heading already written that way', () => {
    expect(headingAnchors('## Notes\n\n## Notes-1\n\n## Notes\n')).toEqual([
      'notes',
      'notes-1',
      'notes-1',
    ]);
    expect(headingAnchors('## a\n## a\n## a-1\n## a\n')).toEqual(['a', 'a-1', 'a-1', 'a-2']);
  });

  it("masks a heading's single-backtick code spans out before slugging, as the wiki does", () => {
    expect(headingAnchors('## The `yaml` parser\n')).toEqual(['the--parser']);
    expect(headingAnchors('## `x` parser\n')).toEqual(['parser']);
    // The wiki's span is one backtick to the next, so a double-backtick span splits differently.
    expect(headingAnchors('## Using ``a ` b`` here\n')).toEqual(['using--b-here']);
  });

  it('gives a heading that is only code no heading when nothing follows the hashes', () => {
    expect(headingAnchors('## `yaml`\n\n## After\n')).toEqual(['after']);
  });

  it('counts a heading whose text masks to nothing, with an empty id', () => {
    expect(headingAnchors('## `yaml` \n\n## After\n')).toEqual(['', 'after']);
    expect(headingAnchors('## `a` `b`\n\n## After\n')).toEqual(['', 'after']);
    expect(headingAnchors('##  \n\n## After\n')).toEqual(['', 'after']);
    expect(headingAnchors('## !!!\n\n## ???\n')).toEqual(['', '-1']);
  });

  it('needs something after the whitespace — a lone space or bare hashes is no heading', () => {
    expect(headingAnchors('## \n\n##\n\n## After\n')).toEqual(['after']);
  });

  it('reads any whitespace after the hashes, a no-break space included', () => {
    expect(headingAnchors('##\u00A0Nbsp\n\n##\tTabbed\n')).toEqual(['nbsp', 'tabbed']);
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

  it('closes a fence on any later fence line of the same character, whatever its length', () => {
    expect(headingAnchors('````\n```\n## inside?\n````\n## After\n')).toEqual(['inside']);
    expect(headingAnchors('````\n## inside\n```\n## after-short\n')).toEqual(['after-short']);
    expect(headingAnchors('```\n## a\n```js\n## b\n')).toEqual(['b']);
    expect(headingAnchors('```\n~~~\n## inside\n```\n## After\n')).toEqual(['after']);
  });

  it('ignores a heading after an unclosed fence, to the end of the page', () => {
    expect(headingAnchors('## Before\n\n```\n## Inside\n')).toEqual(['before']);
  });

  it('never lets an inline code span reach past its line, as the wiki masks line by line', () => {
    expect(headingAnchors('Some `code that wraps\n## onto this line` here\n\n## Real\n')).toEqual([
      'onto-this-line-here',
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

  it('matches the wiki’s own table (scripts/lib/wiki.test.ts)', () => {
    expect(
      headingAnchors('# Title\n\nText\n\n```\n# not a heading\n```\n\n## Sub heading\n'),
    ).toEqual(['title', 'sub-heading']);
    expect(headingAnchors('## Heading ##\n')).toEqual(['heading']);
    expect(headingAnchors('## Overview\n\nA\n\n## Overview\n\nB\n\n## Overview\n\nC\n')).toEqual([
      'overview',
      'overview-1',
      'overview-2',
    ]);
    expect(headingAnchors('## q-abc-1234\n')).toContain('q-abc-1234');
  });

  it('keeps the text before a closing # with no space, and trailing spaces off', () => {
    expect(headingAnchors('## C#\n\n## F# ##\n\n## Title   \n')).toEqual(['c', 'f', 'title']);
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

  it('never draws an empty id, but still lets it number the repeat after it', () => {
    const body = '## !!!\n\n## ???\n';
    const empty = heading(1, 1, 0);
    const repeat = heading(3, 1, body.indexOf('## ???'));
    remarkHeadingIds(body)()({ type: 'root', children: [empty, repeat] });
    expect(empty.data).toBeUndefined();
    expect(repeat.data?.hProperties?.['id']).toBe('-1');
  });

  it('skips a heading node whose source does not start with #', () => {
    const body = '> ## Quoted\n';
    const quoted = heading(1, 3, 2);
    remarkHeadingIds(body)()({ type: 'root', children: [quoted] });
    expect(quoted.data).toBeUndefined();
  });
});
