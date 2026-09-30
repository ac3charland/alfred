import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ParseError, type Rates, parsePricingPage } from './page';

const page = readFileSync(path.join(__dirname, '__fixtures__', 'pricing-2026-09-30.txt'), 'utf8');

/** The parsed fixture, failing loudly (rather than narrowing with a cast) if it is rejected. */
function parsed(markdown: string = page, known = new Set<string>()): Rates {
  const result = parsePricingPage(markdown, known);
  if (result instanceof ParseError) throw new Error(`rejected: ${result.reason}`);
  return result;
}

/** The reason a mutated page is rejected for. */
function rejection(markdown: string, known = new Set<string>()): string {
  const result = parsePricingPage(markdown, known);
  if (!(result instanceof ParseError)) throw new Error('expected a rejection');
  return result.reason;
}

/** The fixture with its first occurrence of `from` replaced by `to`, asserted to have changed. */
function mutate(from: string, to: string): string {
  expect(page).toContain(from);
  return page.replace(from, to);
}

describe('parsePricingPage over the live page', () => {
  it('reads all nineteen models of the model table, and only that table', () => {
    const rates = parsed();

    expect(Object.keys(rates)).toHaveLength(19);
    // The batch and tool-use tables carry rows for some of the same models with other prices;
    // none of those may leak into the result.
    expect(rates['claude-opus-5-5']).toEqual({
      name: 'Claude Opus 5.5',
      in: 4,
      cw5m: 5,
      cw1h: 8,
      read: 0.2,
      out: 20,
    });
  });

  it('reads the rates exactly as the page prints them', () => {
    const rates = parsed();

    expect(rates['claude-haiku-3-5']).toEqual({
      name: 'Claude Haiku 3.5',
      in: 0.8,
      cw5m: 1,
      cw1h: 1.6,
      read: 0.08,
      out: 4,
    });
    expect(rates['claude-haiku-4-5']).toEqual({
      name: 'Claude Haiku 4.5',
      in: 1,
      cw5m: 1.25,
      cw1h: 2,
      read: 0.1,
      out: 5,
    });
    expect(rates['claude-opus-4-1']).toEqual({
      name: 'Claude Opus 4.1',
      in: 15,
      cw5m: 18.75,
      cw1h: 30,
      read: 1.5,
      out: 75,
    });
  });

  it('strips footnote markers from price cells', () => {
    // Sonnet 5 carries a <sup>3</sup> on its input and output cells.
    expect(parsed()['claude-sonnet-5']).toEqual({
      name: 'Claude Sonnet 5',
      in: 2,
      cw5m: 2.5,
      cw1h: 4,
      read: 0.2,
      out: 10,
    });
    // ...and Fable 5.1 one on its cache-hit cell.
    expect(parsed()['claude-fable-5-1']?.read).toBe(0.25);
  });

  it('reduces a linked parenthetical to nothing but the model name', () => {
    const rates = parsed();

    expect(rates['claude-mythos-5-1']).toEqual({
      name: 'Claude Mythos 5.1',
      in: 10,
      cw5m: 12.5,
      cw1h: 20,
      read: 0.25,
      out: 50,
    });
    expect(rates['claude-mythos-5']?.name).toBe('Claude Mythos 5');
    // A "(retired, …)" note with a link inside it goes the same way.
    expect(rates['claude-sonnet-4']?.name).toBe('Claude Sonnet 4');
    expect(rates['claude-opus-4']?.name).toBe('Claude Opus 4');
  });

  it('derives ids by lowercasing and turning spaces and dots into hyphens', () => {
    expect(new Set(Object.keys(parsed()))).toEqual(
      new Set([
        'claude-fable-5',
        'claude-fable-5-1',
        'claude-haiku-3-5',
        'claude-haiku-4-5',
        'claude-mythos-5',
        'claude-mythos-5-1',
        'claude-opus-4',
        'claude-opus-4-1',
        'claude-opus-4-5',
        'claude-opus-4-6',
        'claude-opus-4-7',
        'claude-opus-4-8',
        'claude-opus-5',
        'claude-opus-5-5',
        'claude-sonnet-4',
        'claude-sonnet-4-5',
        'claude-sonnet-4-6',
        'claude-sonnet-5',
        'claude-sonnet-5-5',
      ]),
    );
  });

  it('accepts a known set the page still covers', () => {
    expect(
      parsePricingPage(page, new Set(['claude-opus-5-5', 'claude-haiku-4-5'])),
    ).not.toBeInstanceOf(ParseError);
  });

  it('does not mistake the other tables for the model table', () => {
    // Everything after the model table: the batch, long-context and tool-use tables, several of
    // which list the same models under other prices and a header of their own.
    const lines = page.split('\n');
    const modelTableEnd = lines.findIndex((line) => line.startsWith('*<sup>1 '));
    const afterIt = lines.slice(modelTableEnd).join('\n');

    expect(afterIt).toContain('Batch input');
    expect(rejection(afterIt)).toBe('header not found');
  });
});

describe('parsePricingPage rejections', () => {
  it('rejects a page whose model table header was renamed', () => {
    expect(rejection(mutate('| Output tokens          |', '| Completion tokens      |'))).toBe(
      'header not found',
    );
  });

  it('rejects an empty page', () => {
    expect(rejection('')).toBe('header not found');
  });

  it('rejects a price cell that is not $n / MTok', () => {
    expect(rejection(mutate('| $4 / MTok             |', '| $x / MTok             |'))).toBe(
      'malformed price: Claude Opus 5.5: $x / MTok',
    );
  });

  it('rejects a price cell with the wrong unit', () => {
    expect(rejection(mutate('| $4 / MTok             |', '| $4 / KTok             |'))).toContain(
      'malformed price: Claude Opus 5.5',
    );
  });

  it('rejects a price cell with a thousands separator or a missing space', () => {
    expect(rejection(mutate('| $4 / MTok             |', '| $4/MTok               |'))).toContain(
      'malformed price',
    );
    expect(rejection(mutate('| $4 / MTok             |', '| $1,000 / MTok         |'))).toContain(
      'malformed price',
    );
  });

  it('rejects a row with a missing cell', () => {
    expect(
      rejection(
        mutate(
          '| $2.50 / MTok    | $4 / MTok       | $0.20 / MTok             | $10 / MTok             |\n| Claude Sonnet 5 ',
          '| $2.50 / MTok    | $4 / MTok       | $0.20 / MTok             |\n| Claude Sonnet 5 ',
        ),
      ),
    ).toContain('malformed row');
  });

  it('rejects a row whose columns were swapped so that ordering breaks', () => {
    // Opus 5.5 with its 5m and 1h cache writes exchanged: 1h < 5m.
    expect(
      rejection(
        mutate('| $5 / MTok       | $8 / MTok       |', '| $8 / MTok       | $5 / MTok       |'),
      ),
    ).toBe('ordering violated: Claude Opus 5.5');
  });

  it('rejects a cache read that costs as much as input', () => {
    expect(rejection(mutate('| $0.20 / MTok<sup>2</sup> |', '| $4 / MTok<sup>2</sup>    |'))).toBe(
      'ordering violated: Claude Opus 5.5',
    );
  });

  it('rejects output that does not outprice input', () => {
    expect(rejection(mutate('| $20 / MTok             |', '| $4 / MTok              |'))).toBe(
      'ordering violated: Claude Opus 5.5',
    );
  });

  it('rejects a table cut to four rows', () => {
    const lines = page.split('\n');
    const first = lines.findIndex((line) => line.startsWith('| Claude Fable 5.1'));
    const cut = [...lines.slice(0, first + 4), ...lines.slice(first + 19)].join('\n');

    expect(rejection(cut)).toBe('only 4 rows');
  });

  it('accepts exactly five rows', () => {
    const lines = page.split('\n');
    const first = lines.findIndex((line) => line.startsWith('| Claude Fable 5.1'));
    const cut = [...lines.slice(0, first + 5), ...lines.slice(first + 19)].join('\n');

    expect(Object.keys(parsed(cut))).toHaveLength(5);
  });

  it('rejects a fetch that lost more than half of the known models', () => {
    const known = new Set(['claude-opus-5-5', 'claude-opus-6', 'claude-opus-7', 'claude-opus-8']);

    // Three of the four are absent from the page.
    expect(rejection(page, known)).toBe('3 of 4 known models missing');
  });

  it('keeps a fetch that lost exactly half of the known models', () => {
    const known = new Set([
      'claude-opus-5-5',
      'claude-haiku-4-5',
      'claude-opus-6',
      'claude-opus-7',
    ]);

    expect(parsePricingPage(page, known)).not.toBeInstanceOf(ParseError);
  });

  it('never trips the known-models rule when there is no history yet', () => {
    expect(parsePricingPage(page, new Set())).not.toBeInstanceOf(ParseError);
  });

  it('rejects the same model listed twice', () => {
    const row = '| Claude Haiku 4.5 ';
    const lines = page.split('\n');
    const at = lines.findIndex((line) => line.startsWith(row));
    const duplicated = [...lines.slice(0, at + 1), lines[at], ...lines.slice(at + 1)].join('\n');

    expect(rejection(duplicated)).toBe('duplicate model: Claude Haiku 4.5');
  });
});
