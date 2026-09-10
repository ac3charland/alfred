import type { CommTier } from '../types';
import { type ScoredResult, renderConfusion, scoreRun } from './score';

/** One comparison, written as `expected → actual`. */
function result(expected: CommTier, actual: CommTier): ScoredResult {
  return {
    expected: { queued: expected !== 'fyi', tier: expected },
    actual: { queued: actual !== 'fyi', tier: actual },
  };
}

describe('scoreRun', () => {
  it('scores a perfect run at one across the board', () => {
    const score = scoreRun([
      result('asap', 'asap'),
      result('today', 'today'),
      result('whenever', 'whenever'),
      result('fyi', 'fyi'),
    ]);

    expect(score).toMatchObject({
      queueRecall: 1,
      queuePrecision: 1,
      asapPrecision: 1,
      asapRecall: 1,
      tierAccuracy: 1,
    });
  });

  it('counts a shelved obligation against recall and nothing else', () => {
    // The failure the whole module exists to prevent, and the one no correction ever records.
    // Four should be queued; three were. Everything queued belonged there.
    const score = scoreRun([
      result('today', 'fyi'),
      result('today', 'today'),
      result('whenever', 'whenever'),
      result('asap', 'asap'),
      result('fyi', 'fyi'),
    ]);

    expect(score.queueRecall).toBe(0.75);
    expect(score.queuePrecision).toBe(1);
  });

  it('counts an over-surfaced message against precision, not recall', () => {
    // The price of the recall bias: a glance, not a missed obligation.
    const score = scoreRun([
      result('fyi', 'today'),
      result('today', 'today'),
      result('fyi', 'fyi'),
    ]);

    expect(score.queueRecall).toBe(1);
    expect(score.queuePrecision).toBe(0.5);
  });

  it('separates the two asap numbers, which is why there are two of them', () => {
    // Two calls of asap, one earned: precision 0.5. Three deserved it, one got it: recall 1/3.
    const score = scoreRun([
      result('asap', 'asap'),
      result('asap', 'today'),
      result('asap', 'today'),
      result('today', 'asap'),
      result('fyi', 'fyi'),
    ]);

    expect(score.asapPrecision).toBe(0.5);
    expect(score.asapRecall).toBeCloseTo(1 / 3);
  });

  it('scores exact-tier agreement apart from the queue boundary', () => {
    // Both are queued, so the queue numbers are perfect while the tier was still wrong.
    const score = scoreRun([result('today', 'whenever'), result('today', 'today')]);

    expect(score.queueRecall).toBe(1);
    expect(score.tierAccuracy).toBe(0.5);
  });

  it('answers an empty denominator with one rather than a division by zero', () => {
    // Nothing was called asap, so nothing was called asap wrongly — and the recall beside it is
    // what shows the miss.
    const score = scoreRun([result('asap', 'today'), result('fyi', 'fyi')]);

    expect(score.asapPrecision).toBe(1);
    expect(score.asapRecall).toBe(0);
  });

  it('scores an empty run without dividing by zero', () => {
    expect(scoreRun([])).toMatchObject({
      queueRecall: 1,
      queuePrecision: 1,
      tierAccuracy: 1,
    });
  });

  it('builds a full confusion matrix, zeros included', () => {
    const score = scoreRun([
      result('today', 'fyi'),
      result('today', 'fyi'),
      result('asap', 'asap'),
    ]);

    expect(score.confusion.today.fyi).toBe(2);
    expect(score.confusion.asap.asap).toBe(1);
    expect(score.confusion.whenever.today).toBe(0);
    expect(Object.keys(score.confusion)).toEqual(['asap', 'today', 'whenever', 'fyi']);
  });
});

describe('renderConfusion', () => {
  it('lays the matrix out with expected down the side and actual across the top', () => {
    const { confusion } = scoreRun([result('today', 'fyi')]);

    const table = renderConfusion(confusion).split('\n');

    expect(table[0]).toContain(String.raw`expected \ actual`);
    expect(table[0]).toContain('whenever');
    expect(table[2]).toMatch(/^today/);
  });
});
