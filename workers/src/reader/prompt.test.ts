import { createHash } from 'node:crypto';

import { extractPost } from './extract';
import { LINK_ROUNDUP_MESSAGE } from './fixtures';
import {
  READER_MODEL_INPUT_CHARS,
  READER_PROMPT_VERSIONS,
  RESEARCH_AUTHOR,
  RESEARCH_PUBLICATION,
  buildReaderRequest,
} from './prompt';
import { READER_ALERTS_SCHEMA, READER_ROUNDUP_SCHEMA, READER_SUMMARY_SCHEMA } from './schema';
import type { SummaryInput } from './types';

const TEXT_MARKER = '--- post text ---\n';
const LINKS_MARKER = '\n\n--- links ---\n';

/** The part of the user turn that is the post's text: after its marker, before the links block. */
function sentText(user: string): string {
  return user.slice(user.indexOf(TEXT_MARKER) + TEXT_MARKER.length, user.indexOf(LINKS_MARKER));
}

/** The links block's lines. */
function sentLinks(user: string): string {
  return user.slice(user.indexOf(LINKS_MARKER) + LINKS_MARKER.length);
}

function post(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    kind: 'essay',
    publication: 'The Diff',
    author: 'Dana Whitfield',
    title: 'The inference cost curve, eighteen months on',
    receivedAt: '2026-09-14T06:03:00.000Z',
    wordCount: 1840,
    text: 'Prices fell twelve-fold. Latency barely moved.',
    ...overrides,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('READER_PROMPT_VERSIONS', () => {
  it('keeps the essay at 2 — the wording that asks for Further reading — and starts the others at 1', () => {
    expect(READER_PROMPT_VERSIONS).toEqual({ essay: 2, roundup: 1, alerts: 1 });
  });
});

describe('buildReaderRequest — the essay is the v2 request, unchanged', () => {
  // Pinned by digest: an essay summary stamped "prompt v2" must have been asked exactly this. A
  // change to either string is a new essay version — bump READER_PROMPT_VERSIONS.essay with it.
  it('sends the v2 system prompt byte for byte', () => {
    expect(sha256(buildReaderRequest(post()).system)).toBe(
      '96712d08e60b301fa15dce68258fe7f2bb60985b4e3c550863fbea9c99693790',
    );
  });

  it('sends the v2 schema byte for byte', () => {
    expect(sha256(JSON.stringify(buildReaderRequest(post()).schema))).toBe(
      '6276e1db00a867094afb24f5ee58bc3840ca9d2d33da81bd41364e66287ca7cc',
    );
  });
});

describe('buildReaderRequest — one static prompt and schema per kind', () => {
  it('gives each kind its own system prompt and schema', () => {
    const essay = buildReaderRequest(post());
    const roundup = buildReaderRequest(post({ kind: 'roundup' }));
    const alerts = buildReaderRequest(post({ kind: 'alerts' }));

    expect(new Set([essay.system, roundup.system, alerts.system]).size).toBe(3);
    expect(essay.schema).toBe(READER_SUMMARY_SCHEMA);
    expect(roundup.schema).toBe(READER_ROUNDUP_SCHEMA);
    expect(alerts.schema).toBe(READER_ALERTS_SCHEMA);
  });

  it('keeps each kind static: two different posts of a kind get byte-identical system text', () => {
    for (const kind of ['roundup', 'alerts'] as const) {
      const first = buildReaderRequest(post({ kind }));
      const second = buildReaderRequest(
        post({ kind, publication: 'Elsewhere', title: 'Other', text: 'x' }),
      );

      expect(first.system).toBe(second.system);
      expect(first.system).not.toContain('The Diff');
    }
  });

  it('shares the user turn across kinds when the post has no HTML', () => {
    const essay = buildReaderRequest(post());

    expect(buildReaderRequest(post({ kind: 'roundup' })).user).toBe(essay.user);
    expect(buildReaderRequest(post({ kind: 'alerts' })).user).toBe(essay.user);
  });

  it('asks a roundup for its highlights and the linked pieces worth reading in full', () => {
    const lower = buildReaderRequest(post({ kind: 'roundup' })).system.toLowerCase();

    expect(lower).toContain('overview.highlights');
    expect(lower).toContain('overview.links');
    expect(lower).toContain('name links by their numbers only');
    expect(lower).toContain('not a table of contents');
    expect(lower).toContain('press release');
    expect(lower).toContain('always the answer when the links block says "none"');
  });

  it('asks Alerts for sales, security, actions and changes, and calls an empty list the common answer', () => {
    const lower = buildReaderRequest(post({ kind: 'alerts' })).system.toLowerCase();

    for (const category of ['sale:', 'security:', 'action:', 'change:']) {
      expect(lower).toContain(category);
    }
    expect(lower).toContain('an empty findings list is the common and correct answer');
    expect(lower).toContain('recommended for you');
    expect(lower).toContain('new arrivals');
    expect(lower).toContain('deadline');
  });

  it('never tells any kind not to think', () => {
    for (const kind of ['roundup', 'alerts'] as const) {
      const lower = buildReaderRequest(post({ kind })).system.toLowerCase();

      expect(lower).not.toContain('do not think');
      expect(lower).not.toContain('without reasoning');
    }
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

  it('states both Further reading tests: the argument rests on it, or a roundup item worth reading in full', () => {
    const lower = buildReaderRequest(post()).system.toLowerCase();

    expect(lower).toContain('further_reading');
    expect(lower).toContain('argument rests on it or engages it at length');
    expect(lower).toContain('builds on, rebuts, or quotes substantially');
    expect(lower).toContain('link roundup and that item looks genuinely worth reading in full');
  });

  it('names what Further reading leaves out', () => {
    const lower = buildReaderRequest(post()).system.toLowerCase();

    for (const excluded of [
      'passing citations',
      'support a single fact or number',
      'definitions and reference pages',
      'homepages and product pages',
      'own earlier posts',
      'chrome',
      'sponsors and ads',
    ]) {
      expect(lower).toContain(excluded);
    }
  });

  it('calls an empty Further reading the common answer, and never lets a roundup count wholesale', () => {
    const lower = buildReaderRequest(post()).system.toLowerCase();

    expect(lower).toContain('empty further_reading is the common, correct answer');
    expect(lower).toContain('always when the links block says "none"');
    expect(lower).toContain('pick the few items with real substance, not the list');
    expect(lower).not.toMatch(/every (link|item) in (a|the) roundup/);
    expect(lower).not.toMatch(/all (of )?the (links|items)/);
  });

  it('has the model name links by number and title the linked piece, not the anchor text', () => {
    const lower = buildReaderRequest(post()).system.toLowerCase();

    expect(lower).toContain('name links by their numbers only');
    expect(lower).toContain('title names the linked piece itself');
    expect(lower).toContain('at most about 20 words');
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

  // A research report has no publisher and no byline; the metadata block says what it is instead.
  // The system prompt is untouched by it, so it moves no READER_PROMPT_VERSION.
  it('names the source of a research report on its publication and author lines', () => {
    const { user } = buildReaderRequest(
      post({ publication: RESEARCH_PUBLICATION, author: RESEARCH_AUTHOR }),
    );

    expect(user).toContain(
      'Publication: alfred research — a report written for the owner\nAuthor: Claude Code research routine\n',
    );
  });

  it('leaves a short post untruncated', () => {
    const body = 'a'.repeat(1000);

    expect(buildReaderRequest(post({ text: body })).user).toContain(body);
  });

  it('truncates the text at READER_MODEL_INPUT_CHARS', () => {
    const body = 'a'.repeat(READER_MODEL_INPUT_CHARS + 500);

    const { user } = buildReaderRequest(post({ text: body }));

    expect(sentText(user)).toHaveLength(READER_MODEL_INPUT_CHARS);
  });

  it('truncates on a code-point boundary, never mid-surrogate-pair', () => {
    // An astral character is two code units, so a pair straddles the cap exactly.
    const body = `${'a'.repeat(READER_MODEL_INPUT_CHARS - 1)}😀tail`;

    const { user } = buildReaderRequest(post({ text: body }));

    const sent = sentText(user);
    expect(sent).toHaveLength(READER_MODEL_INPUT_CHARS - 1);
    expect(sent).not.toContain('\uD83D');
    expect(/^a+$/u.test(sent)).toBe(true);
  });
});

describe('buildReaderRequest — the links', () => {
  const roundup = extractPost(LINK_ROUNDUP_MESSAGE, { name: 'Gridwork' });

  it('builds the text from the HTML, with a [n] marker after each linked phrase', () => {
    const { user } = buildReaderRequest(
      post({ text: roundup.text, html: roundup.html, canonicalUrl: roundup.canonical_url }),
    );

    expect(sentText(user)).toContain('The sim-to-real gap in dexterous manipulation [1]');
    expect(sentText(user)).toContain('FoldBench v2 release notes [4]');
  });

  it('lists each number’s URL after the text, one per line, and returns the same links', () => {
    const request = buildReaderRequest(
      post({ text: roundup.text, html: roundup.html, canonicalUrl: roundup.canonical_url }),
    );

    const lines = sentLinks(request.user).split('\n');
    expect(lines[0]).toBe('[1] https://substack.com/redirect/3d1f6a52-8b0e-4c7a-9e21-0a4f5c6d7e81');
    expect(lines).toHaveLength(8);
    expect(request.links.map((link) => `[${String(link.n)}] ${link.url}`)).toEqual(lines);
  });

  it('says "none" for a post with no HTML, and sends its stored text as it is', () => {
    const request = buildReaderRequest(post());

    expect(sentLinks(request.user)).toBe('none');
    expect(sentText(request.user)).toBe('Prices fell twelve-fold. Latency barely moved.');
    expect(request.links).toEqual([]);
  });

  it('says "none" for HTML with no candidate link', () => {
    const request = buildReaderRequest(
      post({ html: '<p>No links <a href="mailto:x@y.z">here</a>.</p>' }),
    );

    expect(sentLinks(request.user)).toBe('none');
  });

  it('bounds text and list together — the text first, then whole list lines while they fit', () => {
    const links =
      '<a href="https://example.com/one">one</a> <a href="https://example.com/two">two</a>';
    // Room for the text and exactly one list line after it.
    const firstLine = '[1] https://example.com/one';
    const padding = 'a'.repeat(
      READER_MODEL_INPUT_CHARS - 'one [1] two [2] '.length - firstLine.length - 1,
    );
    const request = buildReaderRequest(post({ html: `<p>${links} ${padding}</p>` }));

    expect(sentText(request.user).length + firstLine.length + 1).toBe(READER_MODEL_INPUT_CHARS);
    expect(sentLinks(request.user)).toBe(firstLine);
    expect(request.links).toEqual([{ n: 1, url: 'https://example.com/one' }]);
  });

  it('gives the list "none" when the text alone fills the cap', () => {
    const request = buildReaderRequest(
      post({
        html: `<p><a href="https://example.com/one">one</a> ${'a'.repeat(READER_MODEL_INPUT_CHARS)}</p>`,
      }),
    );

    expect(sentText(request.user)).toHaveLength(READER_MODEL_INPUT_CHARS);
    expect(sentLinks(request.user)).toBe('none');
    expect(request.links).toEqual([]);
  });
});

describe('buildReaderRequest — an Alerts post goes without its links', () => {
  const roundup = extractPost(LINK_ROUNDUP_MESSAGE, { name: 'Gridwork' });
  const input = post({
    kind: 'alerts',
    text: roundup.text,
    html: roundup.html,
    canonicalUrl: roundup.canonical_url,
  });

  it('sends the text rebuilt from the HTML with no [n] markers, and a links block of none', () => {
    const request = buildReaderRequest(input);

    expect(sentText(request.user)).toContain('The sim-to-real gap in dexterous manipulation');
    expect(sentText(request.user)).not.toMatch(/\[\d+\]/u);
    expect(sentLinks(request.user)).toBe('none');
    expect(request.links).toEqual([]);
  });

  it('leaves the stored HTML as it was', () => {
    const before = input.html;

    buildReaderRequest(input);

    expect(input.html).toBe(before);
  });

  it('sends the same post to a roundup with its links numbered', () => {
    const request = buildReaderRequest({ ...input, kind: 'roundup' });

    expect(sentText(request.user)).toContain('FoldBench v2 release notes [4]');
    expect(request.links.length).toBeGreaterThan(0);
  });
});

describe('buildReaderRequest — the schema', () => {
  it('passes READER_SUMMARY_SCHEMA through untouched', () => {
    expect(buildReaderRequest(post()).schema).toBe(READER_SUMMARY_SCHEMA);
  });
});
