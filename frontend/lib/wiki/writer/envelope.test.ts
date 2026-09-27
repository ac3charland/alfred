import {
  type KnowledgeItemForWiki,
  type ReaderPostForWiki,
  knowledgeEnvelope,
  readerEnvelope,
} from './envelope';

/**
 * Golden files: the exact bytes each kind of send commits. These are what the wiki repo's own
 * lint and filing steps are run against in the cross-repo contract check, so a change here is a
 * change to the contract, not a formatting preference.
 */

const POST: ReaderPostForWiki = {
  id: '6f1c2b3a-0000-4000-8000-000000000001',
  title: 'Why habits stick',
  author: 'Jane Doe',
  canonical_url: 'https://janedoe.substack.com/p/why-habits-stick',
  received_at: '2026-10-02T22:15:00.000Z',
  text: 'Habits are the compound interest of self-improvement.\n\nStart tiny.',
};

const IDEAS = [
  'Habit stacking works because the cue is an existing routine, not a time of day.',
  'Environment design beats willpower\nfor the first thirty days.',
];

const EVIDENCE = [
  'Lally et al. (2010): median 66 days to automaticity, ranging from 18 to 254.',
  'A survey of 2,000 habit-app users:\nstreak users lapsed 40% more often after a first miss.',
];

/** A send of Novel ideas alone — what every send was before Evidence could be picked. */
const IDEAS_ONLY = { ideas: IDEAS, evidence: [] };

const CAPTURED = '2026-10-03';

const CORE_LINES = [
  'source_type: "reader-post"',
  'origin: "third-party"',
  'title: "Why habits stick"',
  'author: "Jane Doe"',
  'source_url: "https://janedoe.substack.com/p/why-habits-stick"',
  'published: "2026-10-02"',
  'captured: "2026-10-03"',
  'via: "alfred-reader"',
  'external_id: "alfred:reader-post:6f1c2b3a-0000-4000-8000-000000000001"',
];

/** The picks file's frontmatter: the source's, with the model as its origin. */
const PICKS_FRONTMATTER = [
  '---',
  ...CORE_LINES.map((line) =>
    line === 'origin: "third-party"' ? 'origin: "model-derived"' : line,
  ),
  '---',
  '',
];

function picksOf(envelope: ReturnType<typeof readerEnvelope>): string {
  const picks = envelope.files.find((file) => file.name === `picks-${CAPTURED}.md`);
  if (picks === undefined) throw new Error('no picks file');
  return picks.content;
}

describe('readerEnvelope', () => {
  it('golden: a full-text send is source.md with the text verbatim plus the headed picks', () => {
    const envelope = readerEnvelope(POST, IDEAS_ONLY, CAPTURED);

    expect(envelope.title).toBe('Why habits stick');
    expect(envelope.captured).toBe(CAPTURED);
    expect(envelope.files.map((file) => file.name)).toEqual(['source.md', 'picks-2026-10-03.md']);
    expect(envelope.files[0]?.content).toBe(
      [
        '---',
        ...CORE_LINES,
        'fidelity: "full-text"',
        '---',
        '',
        'Habits are the compound interest of self-improvement.',
        '',
        'Start tiny.',
        '',
      ].join('\n'),
    );
    expect(envelope.files[1]?.content).toBe(
      [
        ...PICKS_FRONTMATTER,
        '## Novel ideas',
        '',
        '- Habit stacking works because the cue is an existing routine, not a time of day.',
        '- Environment design beats willpower for the first thirty days.',
        '',
      ].join('\n'),
    );
  });

  it('golden: a mixed send heads the ideas, then the evidence, in one picks file', () => {
    const envelope = readerEnvelope(POST, { ideas: IDEAS, evidence: EVIDENCE }, CAPTURED);

    expect(envelope.files.map((file) => file.name)).toEqual(['source.md', 'picks-2026-10-03.md']);
    expect(picksOf(envelope)).toBe(
      [
        ...PICKS_FRONTMATTER,
        '## Novel ideas',
        '',
        '- Habit stacking works because the cue is an existing routine, not a time of day.',
        '- Environment design beats willpower for the first thirty days.',
        '',
        '## Evidence',
        '',
        '- Lally et al. (2010): median 66 days to automaticity, ranging from 18 to 254.',
        '- A survey of 2,000 habit-app users: streak users lapsed 40% more often after a first miss.',
        '',
      ].join('\n'),
    );
  });

  it('golden: an evidence-only send heads the evidence and leaves Novel ideas out', () => {
    const envelope = readerEnvelope(POST, { ideas: [], evidence: [EVIDENCE[0] ?? ''] }, CAPTURED);

    expect(envelope.files.map((file) => file.name)).toEqual(['source.md', 'picks-2026-10-03.md']);
    expect(picksOf(envelope)).toBe(
      [
        ...PICKS_FRONTMATTER,
        '## Evidence',
        '',
        '- Lally et al. (2010): median 66 days to automaticity, ranging from 18 to 254.',
        '',
      ].join('\n'),
    );
  });

  it('golden: a swept post with a URL sends a pointer — an empty body ending at the fence', () => {
    const envelope = readerEnvelope(
      { ...POST, text: null },
      { ideas: [IDEAS[0] ?? ''], evidence: [] },
      CAPTURED,
    );

    expect(envelope.files.map((file) => file.name)).toEqual(['source.md', 'picks-2026-10-03.md']);
    expect(envelope.files[0]?.content).toBe(
      ['---', ...CORE_LINES, 'fidelity: "pointer"', '---', ''].join('\n'),
    );
    expect(picksOf(envelope)).toBe(
      [
        ...PICKS_FRONTMATTER,
        '## Novel ideas',
        '',
        '- Habit stacking works because the cue is an existing routine, not a time of day.',
        '',
      ].join('\n'),
    );
  });

  it('golden: a swept post with no URL sends the picks alone', () => {
    const envelope = readerEnvelope(
      { ...POST, text: '', canonical_url: null },
      { ideas: [IDEAS[0] ?? ''], evidence: [] },
      CAPTURED,
    );

    expect(envelope.files.map((file) => file.name)).toEqual(['picks-2026-10-03.md']);
    expect(envelope.files[0]?.content).toContain('source_url: null');
    expect(envelope.files[0]?.content).not.toContain('fidelity');
    expect(envelope.files[0]?.content).toMatch(
      /\n---\n\n## Novel ideas\n\n- Habit stacking works because the cue is an existing routine, not a time of day\.\n$/,
    );
  });

  it('writes source_url null for a canonical URL that does not parse, and keeps the text', () => {
    const envelope = readerEnvelope({ ...POST, canonical_url: 'not a url' }, IDEAS_ONLY, CAPTURED);
    expect(envelope.files[0]?.content).toContain('source_url: null');
    expect(envelope.files[0]?.content).toContain('fidelity: "full-text"');
  });

  it('dates published from received_at in UTC', () => {
    const envelope = readerEnvelope(
      { ...POST, received_at: '2026-10-02T23:30:00-05:00' },
      IDEAS_ONLY,
      CAPTURED,
    );
    expect(envelope.files[0]?.content).toContain('published: "2026-10-03"');
  });

  it('carries a null author through', () => {
    const envelope = readerEnvelope({ ...POST, author: null }, IDEAS_ONLY, CAPTURED);
    expect(envelope.files[0]?.content).toContain('author: null');
  });

  // The wiki's lint refuses a blank `author` or `title` (core-frontmatter), and reads a blank body
  // as empty — so none of these may reach a file as written.
  it.each(['', ' '.repeat(3), '\t\n'])(
    'writes a blank author %j as null in every file',
    (author) => {
      const envelope = readerEnvelope({ ...POST, author }, IDEAS_ONLY, CAPTURED);
      for (const file of envelope.files) {
        expect(file.content).toContain('author: null');
      }
    },
  );

  it.each(['', ' '.repeat(3)])(
    'titles a post with a blank title %j Untitled, as its slug is',
    (title) => {
      const envelope = readerEnvelope({ ...POST, title }, IDEAS_ONLY, CAPTURED);
      expect(envelope.title).toBe('Untitled');
      for (const file of envelope.files) {
        expect(file.content).toContain('title: "Untitled"');
      }
    },
  );

  it.each(['\n\n', ' '.repeat(3), ' \t\n '])(
    'reads whitespace-only text %j as gone: a pointer with an empty body, never full-text',
    (text) => {
      const envelope = readerEnvelope({ ...POST, text }, IDEAS_ONLY, CAPTURED);
      expect(envelope.files[0]?.content).toBe(
        ['---', ...CORE_LINES, 'fidelity: "pointer"', '---', ''].join('\n'),
      );
    },
  );

  it('omits source.md for whitespace-only text with no URL, as for no text at all', () => {
    const envelope = readerEnvelope(
      { ...POST, text: '  \n', canonical_url: null },
      { ideas: [IDEAS[0] ?? ''], evidence: [] },
      CAPTURED,
    );
    expect(envelope.files.map((file) => file.name)).toEqual(['picks-2026-10-03.md']);
  });
});

const ITEM: KnowledgeItemForWiki = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Spaced repetition works because forgetting is the signal, not the failure',
  notes: 'Forgetting curve → review just before recall would fail.\n',
  source_url: 'https://example.com/spaced',
};

describe('knowledgeEnvelope', () => {
  it('golden: a notes send is one notes file — title, blank line, notes — with no fidelity', () => {
    const envelope = knowledgeEnvelope(ITEM, CAPTURED);

    expect(envelope.title).toBe(ITEM.title);
    expect(envelope.files.map((file) => file.name)).toEqual(['notes-2026-10-03.md']);
    expect(envelope.files[0]?.content).toBe(
      [
        '---',
        'source_type: "idea"',
        'origin: "mine"',
        'title: "Spaced repetition works because forgetting is the signal, not the failure"',
        'author: null',
        'source_url: "https://example.com/spaced"',
        'published: null',
        'captured: "2026-10-03"',
        'via: "alfred-inbox"',
        'external_id: "alfred:item:22222222-2222-4222-8222-222222222222"',
        '---',
        '',
        'Spaced repetition works because forgetting is the signal, not the failure',
        '',
        'Forgetting curve → review just before recall would fail.',
        '',
      ].join('\n'),
    );
  });

  it('titles an item with a blank title Untitled — frontmatter, body and envelope alike', () => {
    const envelope = knowledgeEnvelope({ ...ITEM, title: '  ', notes: null }, CAPTURED);
    expect(envelope.title).toBe('Untitled');
    expect(envelope.files[0]?.content).toContain('title: "Untitled"');
    expect(envelope.files[0]?.content.endsWith('---\n\nUntitled\n')).toBe(true);
  });

  it('writes the title alone when the item has no notes', () => {
    const envelope = knowledgeEnvelope({ ...ITEM, notes: null, source_url: null }, CAPTURED);
    expect(
      envelope.files[0]?.content.endsWith(
        '---\n\nSpaced repetition works because forgetting is the signal, not the failure\n',
      ),
    ).toBe(true);
    expect(envelope.files[0]?.content).toContain('source_url: null');
  });
});
