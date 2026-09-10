import {
  EXAMPLE_EXCERPT_CHARS,
  EXAMPLE_LIMIT,
  EXAMPLE_WINDOW,
  selectCommExamples,
} from './examples';
import type { CommExample } from './types';

let nextId = 0;

function example(overrides: Partial<CommExample> = {}): CommExample {
  nextId += 1;
  return {
    id: `correction-${String(nextId)}`,
    sender_handle: 'dana@realplay.co',
    sender_name: 'Dana Whitfield',
    account_label: 'RealPlay',
    subject: 'Q3 invoice',
    body_excerpt: 'Can you approve the invoice?',
    chosen_tier: 'today',
    kind: 'tier_change',
    created_at: '2026-09-09T09:00:00.000Z',
    ...overrides,
  };
}

/** A correction that moved a message DOWN — the direction the recall bias makes most common. */
function demotion(overrides: Partial<CommExample> = {}): CommExample {
  return example({ model_tier: 'today', chosen_tier: 'fyi', ...overrides });
}

/** A correction that moved a message UP, including off the shelf. */
function promotion(overrides: Partial<CommExample> = {}): CommExample {
  return example({ model_tier: 'fyi', chosen_tier: 'today', ...overrides });
}

/** A correction on a row that had no verdict to contrast against — the ceiling, a decode failure. */
function neutral(overrides: Partial<CommExample> = {}): CommExample {
  return example({ chosen_tier: 'whenever', ...overrides });
}

function times<T>(count: number, make: () => T): T[] {
  return Array.from({ length: count }, () => make());
}

describe('selectCommExamples', () => {
  it('draws no more than the cap', () => {
    const drawn = selectCommExamples(times(40, () => promotion()));

    expect(drawn).toHaveLength(EXAMPLE_LIMIT);
  });

  it('keeps everything when the window holds less than the cap', () => {
    const drawn = selectCommExamples([promotion(), demotion(), neutral()]);

    expect(drawn).toHaveLength(3);
  });

  it('holds a demotion-heavy window to half the draw while promotions remain', () => {
    // The correction the owner actually makes is "you queued this, I'd have shelved it", because
    // the classifier deliberately over-surfaces. Drawn by recency alone, the example set would
    // teach the model to shelve more — eroding the recall bias through the mechanism built to
    // improve it, and silently, since a wrongly-shelved message is the failure nobody sees.
    const drawn = selectCommExamples([
      ...times(50, () => demotion()),
      ...times(6, () => promotion()),
    ]);

    const demotions = drawn.filter((drawnExample) => drawnExample.chosen_tier === 'fyi');
    expect(drawn).toHaveLength(EXAMPLE_LIMIT);
    expect(demotions.length).toBeLessThanOrEqual(EXAMPLE_LIMIT / 2);
  });

  it('fills the draw from one direction rather than leaving slots empty', () => {
    // Balance is a preference, not a quota: a log that only ever moved one way still teaches.
    const drawn = selectCommExamples(times(20, () => demotion()));

    expect(drawn).toHaveLength(EXAMPLE_LIMIT);
  });

  it('reads a clearing gesture as a demotion even with no tier to contrast', () => {
    // "It asked nothing" is the cheapest exit a wrongly-queued message has, so it is also the
    // most common correction. Bucketed as neutral it would escape the balance entirely and teach
    // the model to shelve more — the very drift the balance exists to stop.
    const clearing = example({ id: 'clearing', kind: 'nothing_to_answer', chosen_tier: 'fyi' });
    const moved = demotion({ id: 'moved' });

    const drawn = selectCommExamples([clearing, moved, ...times(6, () => promotion())]);

    // Both sit in the demotion bucket, so they alternate with promotions rather than filling the
    // untaken neutral slot between them.
    expect(drawn[1]?.id).toBe('clearing');
    expect(drawn[3]?.id).toBe('moved');
  });

  it('excludes an example whose text a purge took away', () => {
    const purged = example({ body_excerpt: undefined });
    const empty = example({ body_excerpt: '' });
    const kept = example();

    expect(selectCommExamples([purged, empty, kept])).toEqual([kept]);
  });

  it('re-truncates an over-long excerpt to the budget', () => {
    const drawn = selectCommExamples([example({ body_excerpt: 'x'.repeat(2000) })]);

    expect(drawn[0]?.body_excerpt).toHaveLength(EXAMPLE_EXCERPT_CHARS);
  });

  it('leaves an excerpt already inside the budget untouched', () => {
    const short = 'Can you approve the invoice?';
    const drawn = selectCommExamples([example({ body_excerpt: short })]);

    expect(drawn[0]?.body_excerpt).toBe(short);
  });

  it('does not split a surrogate pair sitting at the truncation boundary', () => {
    // An emoji straddles the 600-char cutoff — a two-code-unit surrogate pair the naive
    // `slice(0, EXAMPLE_EXCERPT_CHARS)` would cut in half, leaving a lone high surrogate. A
    // `TextEncoder`/`TextDecoder` round trip (what `fetch` does on the wire) is the strongest
    // check: it silently turns an unpaired surrogate into U+FFFD.
    const excerpt = 'x'.repeat(EXAMPLE_EXCERPT_CHARS - 1) + '😀' + 'y'.repeat(20);
    const drawn = selectCommExamples([example({ body_excerpt: excerpt })]);
    const trimmedExcerpt = drawn[0]?.body_excerpt ?? '';

    const roundTripped = new TextDecoder().decode(new TextEncoder().encode(trimmedExcerpt));
    expect(roundTripped).toBe(trimmedExcerpt);
    expect(trimmedExcerpt).not.toContain('�');
  });

  it('preserves recency inside a direction', () => {
    const newest = demotion({ id: 'newest' });
    const older = demotion({ id: 'older' });

    // The store reads the window newest-first, and the draw does not re-sort it.
    expect(selectCommExamples([newest, older]).map((drawn) => drawn.id)).toEqual([
      'newest',
      'older',
    ]);
  });
});

describe('the example budget', () => {
  it('reads a window wider than the cap, so the draw has something to balance from', () => {
    expect(EXAMPLE_WINDOW).toBeGreaterThan(EXAMPLE_LIMIT);
  });

  it('keeps a full draw of excerpts inside the prompt budget the cost estimate assumes', () => {
    // ~150 tokens of message text per example — roughly 600 characters — against a prefix of
    // ~1,500 tokens. A dozen untruncated email bodies would be larger than everything else in the
    // prompt put together, which is the difference between the running cost being real and being
    // decorative.
    const worstCaseTokens = (EXAMPLE_LIMIT * EXAMPLE_EXCERPT_CHARS) / 4;

    expect(worstCaseTokens).toBeLessThanOrEqual(1800);
  });
});
