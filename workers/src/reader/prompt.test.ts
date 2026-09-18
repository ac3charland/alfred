import { READER_MODEL_INPUT_CHARS, READER_PROMPT_VERSION, buildReaderRequest } from './prompt';
import { READER_SUMMARY_SCHEMA } from './schema';
import type { SummaryInput } from './types';

function post(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    publication: 'The Diff',
    author: 'Dana Whitfield',
    title: 'The inference cost curve, eighteen months on',
    receivedAt: '2026-09-14T06:03:00.000Z',
    wordCount: 1840,
    text: 'Prices fell twelve-fold. Latency barely moved.',
    ...overrides,
  };
}

describe('READER_PROMPT_VERSION', () => {
  it('is 1 — the wording this module ships with', () => {
    expect(READER_PROMPT_VERSION).toBe(1);
  });
});

describe('buildReaderRequest — the system prompt', () => {
  it('is static: two different posts get byte-identical system text', () => {
    const first = buildReaderRequest(post());
    const second = buildReaderRequest(
      post({ publication: 'Elsewhere', title: 'Other', text: 'x' }),
    );

    expect(first.system).toBe(second.system);
  });

  it('carries no post-specific text', () => {
    const { system } = buildReaderRequest(post());

    expect(system).not.toContain('The Diff');
    expect(system).not.toContain('Dana Whitfield');
    expect(system).not.toContain('inference cost curve');
  });

  it('says an empty novel_ideas is the honest answer for a restatement', () => {
    const { system } = buildReaderRequest(post());

    expect(system).toContain('novel_ideas');
    expect(system.toLowerCase()).toContain('empty');
    expect(system.toLowerCase()).toContain('restates the current consensus');
  });

  it('scopes "novel" to what a well-read person in the field knows this season', () => {
    expect(buildReaderRequest(post()).system.toLowerCase()).toContain(
      'well-read person in this post',
    );
  });

  it('names the chrome to ignore and how to treat a paywalled teaser', () => {
    const lower = buildReaderRequest(post()).system.toLowerCase();

    expect(lower).toContain('unsubscribe');
    expect(lower).toContain('footer');
    expect(lower).toContain('share this post');
    expect(lower).toContain('comments');
    expect(lower).toContain('teaser');
    expect(lower).toContain('behind the wall');
  });

  it('asks for concreteness and forbids praise and padding', () => {
    const lower = buildReaderRequest(post()).system.toLowerCase();

    expect(lower).toContain('no padding');
    expect(lower).toContain('no praise');
    expect(lower).toContain('numbers');
  });

  it('never tells the model not to think — thinking is switched off on the call instead', () => {
    const lower = buildReaderRequest(post()).system.toLowerCase();

    expect(lower).not.toContain('do not think');
    expect(lower).not.toContain("don't think");
    expect(lower).not.toContain('without reasoning');
    expect(lower).not.toContain('without thinking');
  });
});

describe('buildReaderRequest — the user turn', () => {
  it('opens with the metadata block, then the post text', () => {
    const { user } = buildReaderRequest(post());

    expect(user.startsWith('Publication: The Diff\n')).toBe(true);
    expect(user).toContain('Author: Dana Whitfield');
    expect(user).toContain('Title: The inference cost curve, eighteen months on');
    expect(user).toContain('Date: 2026-09-14T06:03:00.000Z');
    expect(user).toContain('Word count: 1840');
    expect(user).toContain('Prices fell twelve-fold.');
    expect(user.indexOf('Publication:')).toBeLessThan(user.indexOf('Prices fell'));
  });

  it('writes "unknown" for a post with no author rather than dropping the line', () => {
    // The key is OMITTED, not set to undefined: `SummaryInput.author` is `author?: string` under
    // `exactOptionalPropertyTypes`, so an explicit undefined is not a value it can hold.
    const { author, ...withoutAuthor } = post();
    expect(author).toBeDefined();

    const { user } = buildReaderRequest(withoutAuthor);

    expect(user).toContain('Author: unknown');
  });

  it('leaves a short post untruncated', () => {
    const body = 'a'.repeat(1000);

    expect(buildReaderRequest(post({ text: body })).user).toContain(body);
  });

  it('truncates the text at READER_MODEL_INPUT_CHARS', () => {
    const body = 'a'.repeat(READER_MODEL_INPUT_CHARS + 500);

    const { user } = buildReaderRequest(post({ text: body }));

    const marker = '--- post text ---\n';
    const sent = user.slice(user.indexOf(marker) + marker.length);
    expect(sent).toHaveLength(READER_MODEL_INPUT_CHARS);
  });

  it('truncates on a code-point boundary, never mid-surrogate-pair', () => {
    // An astral character is two code units, so a pair straddles the cap exactly.
    const body = `${'a'.repeat(READER_MODEL_INPUT_CHARS - 1)}😀tail`;

    const { user } = buildReaderRequest(post({ text: body }));

    const marker = '--- post text ---\n';
    const sent = user.slice(user.indexOf(marker) + marker.length);
    expect(sent).toHaveLength(READER_MODEL_INPUT_CHARS - 1);
    expect(sent).not.toContain('\uD83D');
    expect(/^a+$/u.test(sent)).toBe(true);
  });
});

describe('buildReaderRequest — the schema', () => {
  it('passes READER_SUMMARY_SCHEMA through untouched', () => {
    expect(buildReaderRequest(post()).schema).toBe(READER_SUMMARY_SCHEMA);
  });
});
