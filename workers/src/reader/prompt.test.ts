import { extractPost } from './extract';
import { LINK_ROUNDUP_MESSAGE } from './fixtures';
import { READER_MODEL_INPUT_CHARS, READER_PROMPT_VERSION, buildReaderRequest } from './prompt';
import { READER_SUMMARY_SCHEMA } from './schema';
import type { SummaryInput } from './types';

const TEXT_MARKER = '--- post text ---\n';
const LINKS_MARKER = '\n\n--- links ---\n';

/** What the user turn carries as the post's text: between the two markers. */
function sentText(user: string): string {
  return user.slice(user.indexOf(TEXT_MARKER) + TEXT_MARKER.length, user.indexOf(LINKS_MARKER));
}

/** What the user turn carries as the links block: everything after its marker. */
function sentLinks(user: string): string {
  return user.slice(user.indexOf(LINKS_MARKER) + LINKS_MARKER.length);
}

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
  it('is 2 — the wording that asks for further reading', () => {
    expect(READER_PROMPT_VERSION).toBe(2);
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

  it('states both further-reading tests: a source the argument rests on, a roundup item worth it', () => {
    const lower = buildReaderRequest(post()).system.toLowerCase();

    expect(lower).toContain('further_reading');
    expect(lower).toContain('rests on it or engages it at length');
    expect(lower).toContain('link roundup');
    expect(lower).toContain('genuinely worth reading in full');
  });

  it('names what never counts as further reading', () => {
    const lower = buildReaderRequest(post()).system.toLowerCase();

    expect(lower).toContain('passing citations');
    expect(lower).toContain('a single fact or number');
    expect(lower).toContain('reference pages');
    expect(lower).toContain('product pages');
    expect(lower).toContain('own earlier posts');
    expect(lower).toContain('sponsors');
  });

  it('calls an empty further_reading the common answer, and the only one when there are no links', () => {
    const lower = buildReaderRequest(post()).system.toLowerCase();

    expect(lower).toContain('most posts warrant none or a few');
    expect(lower).toContain('always when the links block says "none"');
  });

  it('never lets a roundup count wholesale', () => {
    const lower = buildReaderRequest(post()).system.toLowerCase();

    expect(lower).toContain('not the list');
    expect(lower).not.toMatch(/every (link|item) in a roundup/);
    expect(lower).not.toMatch(/all (of )?the (links|items) in a roundup/);
  });

  it('asks for link numbers, never URLs, and a title that names the piece', () => {
    const lower = buildReaderRequest(post()).system.toLowerCase();

    expect(lower).toContain('refer to links only by their numbers');
    expect(lower).toContain('not the anchor text');
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

    expect(sentText(buildReaderRequest(post({ text: body })).user)).toBe(body);
  });

  it('truncates the text at READER_MODEL_INPUT_CHARS', () => {
    const body = 'a'.repeat(READER_MODEL_INPUT_CHARS + 500);

    expect(sentText(buildReaderRequest(post({ text: body })).user)).toHaveLength(
      READER_MODEL_INPUT_CHARS,
    );
  });

  it('truncates on a code-point boundary, never mid-surrogate-pair', () => {
    // An astral character is two code units, so a pair straddles the cap exactly.
    const body = `${'a'.repeat(READER_MODEL_INPUT_CHARS - 1)}😀tail`;

    const sent = sentText(buildReaderRequest(post({ text: body })).user);

    expect(sent).toHaveLength(READER_MODEL_INPUT_CHARS - 1);
    expect(sent).not.toContain('\uD83D');
    expect(/^a+$/u.test(sent)).toBe(true);
  });
});

/** The roundup fixture as the tick hands it over: stored text, HTML and canonical URL. */
function roundup(overrides: Partial<SummaryInput> = {}): SummaryInput {
  const extracted = extractPost(LINK_ROUNDUP_MESSAGE, { name: 'Import Notes' });
  return post({
    text: extracted.text,
    html: extracted.html,
    canonicalUrl: extracted.canonical_url,
    ...overrides,
  });
}

describe('buildReaderRequest — the links', () => {
  it('says "none" for a post with no HTML, and offers no links', () => {
    const request = buildReaderRequest(post());

    expect(sentLinks(request.user)).toBe('none');
    expect(request.links).toEqual([]);
  });

  it('marks each link in the text built from the HTML, and lists the numbers after it', () => {
    const request = buildReaderRequest(roundup());
    const text = sentText(request.user);

    expect(text).toContain('The sim-to-real gap in dexterous manipulation [1]');
    expect(text).toContain('Gridline, the GPU cloud for evals [6]');
    expect(sentLinks(request.user).split('\n')).toEqual([
      '[1] https://substack.com/redirect/3f1e0c2a-6b7d-4e58-9a14-2c8d5e7f9b01',
      '[2] https://substack.com/redirect/7a2b9d4e-1c3f-4a6b-8d05-e9f2c1b4a736',
      '[3] https://substack.com/redirect/c5d8e1f3-2a4b-4c7d-9e60-1b3a5c7d9e2f',
      '[4] https://substack.com/redirect/e9b4c2a1-8d6f-4b3e-a705-4f1d2c8e6b93',
      '[5] https://substack.com/redirect/1d7f3b5c-9e2a-4d8b-b316-7c4e2a9f1d58',
      '[6] https://substack.com/redirect/88a1b2c3-d4e5-4f60-8a71-b2c3d4e5f607',
    ]);
    expect(request.links.map((link) => link.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('says "none" for HTML whose every anchor the pre-filter drops, and sends the stored text', () => {
    const request = buildReaderRequest(
      post({ html: '<p>Nothing but <a href="mailto:a@example.com">mail</a>.</p>' }),
    );

    expect(sentLinks(request.user)).toBe('none');
    expect(sentText(request.user)).toBe('Prices fell twelve-fold. Latency barely moved.');
  });

  it('spends the cap on the text first, then on whole lines of the list', () => {
    const html = `<p>${'a'.repeat(1000)} <a href="https://example.com/one">one</a> <a href="https://example.com/two">two</a></p>`;
    const text = `${'a'.repeat(1000)} one [1] two [2]`;
    // Room for the first list line (and its newline) only.
    const firstLine = '[1] https://example.com/one';
    const budget = text.length + firstLine.length + 1;
    const request = buildReaderRequest(post({ html }), budget);

    expect(sentText(request.user)).toBe(text);
    expect(sentLinks(request.user)).toBe(firstLine);
    expect(request.links).toEqual([{ n: 1, url: 'https://example.com/one' }]);
  });

  it('lists nothing when the text alone fills the cap', () => {
    const html = `<p>${'a'.repeat(100)} <a href="https://example.com/one">one</a></p>`;
    const request = buildReaderRequest(post({ html }), 50);

    expect(sentText(request.user)).toHaveLength(50);
    expect(sentLinks(request.user)).toBe('none');
    expect(request.links).toEqual([]);
  });
});

describe('buildReaderRequest — the schema', () => {
  it('passes READER_SUMMARY_SCHEMA through untouched', () => {
    expect(buildReaderRequest(post()).schema).toBe(READER_SUMMARY_SCHEMA);
  });
});
