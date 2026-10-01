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

/** What closes the user turn of a post that offers no links. */
const NONE_BLOCK = '\n\n--- links ---\nnone';

/** The post text as sent: between the text marker and the links block. */
function sentText(user: string): string {
  const marker = '--- post text ---\n';
  const start = user.indexOf(marker) + marker.length;
  return user.slice(start, user.indexOf('\n\n--- links ---\n', start));
}

describe('READER_PROMPT_VERSION', () => {
  it('is 2 — the wording that added further reading', () => {
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

  it('never tells the model not to think — thinking is switched off on the call instead', () => {
    const lower = buildReaderRequest(post()).system.toLowerCase();

    expect(lower).not.toContain('do not think');
    expect(lower).not.toContain("don't think");
    expect(lower).not.toContain('without reasoning');
    expect(lower).not.toContain('without thinking');
  });
});

describe('buildReaderRequest — the further_reading instructions', () => {
  const { system } = buildReaderRequest(post());

  it('tests inclusion on the argument resting on the piece, or on a roundup item worth reading', () => {
    expect(system).toMatch(/argument rests on that piece or engages it at length/);
    expect(system).toMatch(/builds on it, rebuts it, or quotes substantially from it/);
    expect(system).toMatch(/link roundup and that item looks genuinely worth reading in full/);
  });

  it('is selective in a roundup — the few items, never the list', () => {
    expect(system).toMatch(/pick the few items with real substance, not the list/);
    expect(system).not.toMatch(/whole list|every link|all the links|every item/i);
  });

  it('names what to leave out', () => {
    expect(system).toMatch(/passing citations/);
    expect(system).toMatch(/single fact or number/);
    expect(system).toMatch(/definitions and reference pages, homepages and product pages/);
    expect(system).toMatch(/own earlier posts unless the argument depends on them/);
    expect(system).toMatch(/chrome \(subscribe, share, comments, the app/);
    expect(system).toMatch(/sponsors and ads/);
  });

  it('refers to links by number only and describes title and note', () => {
    expect(system).toMatch(/only by its number from the links block\. Never write a URL/);
    expect(system).toMatch(/title names the linked piece itself, not the anchor text/);
    expect(system).toMatch(/note is at most about 20 words/);
  });

  it('makes empty the common answer, and the only one when the block says none', () => {
    expect(system).toMatch(/most posts warrant none or a few/);
    expect(system).toMatch(/empty list is the right answer when nothing qualifies/);
    expect(system).toMatch(/ALWAYS the answer when the links block says "none"/);
  });

  it('lists the field among the Fields', () => {
    expect(system).toMatch(/- overview\.further_reading:/);
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

    const sent = sentText(user);
    expect(sent).toHaveLength(READER_MODEL_INPUT_CHARS - NONE_BLOCK.length);
    expect(user.endsWith(`${'a'.repeat(10)}${NONE_BLOCK}`)).toBe(true);
  });

  it('truncates on a code-point boundary, never mid-surrogate-pair', () => {
    // An astral character is two code units, so a pair straddles the cap exactly.
    const body = `${'a'.repeat(READER_MODEL_INPUT_CHARS - NONE_BLOCK.length - 1)}😀tail`;

    const { user } = buildReaderRequest(post({ text: body }));

    const sent = sentText(user);
    expect(sent).toHaveLength(READER_MODEL_INPUT_CHARS - NONE_BLOCK.length - 1);
    expect(sent).not.toContain('\uD83D');
    expect(/^a+$/u.test(sent)).toBe(true);
  });
});

describe('buildReaderRequest — numbered links', () => {
  const html =
    '<p>See <a href="https://a.example/one">the first piece</a> and ' +
    '<a href="https://b.example/two">the second</a>, plus ' +
    '<a href="https://a.example/one">the first again</a>.</p>' +
    '<a href="https://self.example/p/x?utm=1">this post</a>';

  it('puts [n] markers in the text and lists the links in number order', () => {
    const { user, links } = buildReaderRequest(
      post({ html, text: 'stored text', canonicalUrl: 'https://self.example/p/x' }),
    );

    expect(user).toContain('the first piece [1]');
    expect(user).toContain('the second [2]');
    expect(user).toContain('the first again [1]');
    expect(user).not.toContain('this post [');
    expect(user).not.toContain('stored text');
    expect(
      user.endsWith('\n\n--- links ---\n[1] https://a.example/one\n[2] https://b.example/two'),
    ).toBe(true);
    expect(links).toEqual([
      { n: 1, url: 'https://a.example/one' },
      { n: 2, url: 'https://b.example/two' },
    ]);
  });

  it('writes none for a post without HTML, and uses its stored text', () => {
    const { user, links } = buildReaderRequest(post());
    expect(user.endsWith('--- links ---\nnone')).toBe(true);
    expect(user).toContain('Prices fell twelve-fold.');
    expect(links).toEqual([]);
  });

  it('writes none for HTML that offers no link', () => {
    const { user } = buildReaderRequest(post({ html: '<p>No anchors at all.</p>' }));
    expect(user).toContain('No anchors at all.');
    expect(user.endsWith('--- links ---\nnone')).toBe(true);
  });

  it('holds the links block to a quarter of the cap, whole-line, and gives the text the rest', () => {
    const anchors = Array.from(
      { length: 150 },
      (_, index) =>
        `<a href="https://a.example/${String(index + 1)}/${'x'.repeat(980)}">link ${String(index + 1)}</a> `,
    ).join('');
    const filler = `<p>${'word '.repeat(60_000)}</p>`;
    const { user, links } = buildReaderRequest(post({ html: `${anchors}${filler}` }));

    const block = user.slice(user.indexOf('\n\n--- links ---\n'));
    const lines = block.split('\n').slice(3);
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThan(150);
    expect(lines).toHaveLength(links.length);
    for (const [index, line] of lines.entries()) {
      expect(line).toBe(`[${String(index + 1)}] ${links[index]?.url ?? ''}`);
      expect(line.endsWith('x'.repeat(980))).toBe(true);
    }
    expect(block.length).toBeLessThanOrEqual(READER_MODEL_INPUT_CHARS / 4);
    const afterMeta = user.slice(
      user.indexOf('--- post text ---\n') + '--- post text ---\n'.length,
    );
    expect(afterMeta.length).toBeLessThanOrEqual(READER_MODEL_INPUT_CHARS);
    expect(afterMeta.length).toBeGreaterThan(READER_MODEL_INPUT_CHARS - 10);
  });
});

describe('buildReaderRequest — the schema', () => {
  it('passes READER_SUMMARY_SCHEMA through untouched', () => {
    expect(buildReaderRequest(post()).schema).toBe(READER_SUMMARY_SCHEMA);
  });
});
