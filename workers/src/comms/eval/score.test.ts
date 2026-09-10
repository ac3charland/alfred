import type { CommTier } from '../types';
import { type ScoredResult, renderConfusion, scoreRun, wilsonInterval } from './score';

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
      queueRecall: { rate: 1 },
      queuePrecision: { rate: 1 },
      asapPrecision: { rate: 1 },
      asapRecall: { rate: 1 },
      tierAccuracy: { rate: 1 },
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

    expect(score.queueRecall).toMatchObject({ rate: 0.75, hits: 3, total: 4 });
    expect(score.queuePrecision.rate).toBe(1);
  });

  it('counts an over-surfaced message against precision, not recall', () => {
    // The price of the recall bias: a glance, not a missed obligation.
    const score = scoreRun([
      result('fyi', 'today'),
      result('today', 'today'),
      result('fyi', 'fyi'),
    ]);

    expect(score.queueRecall.rate).toBe(1);
    expect(score.queuePrecision).toMatchObject({ rate: 0.5, hits: 1, total: 2 });
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

    expect(score.asapPrecision).toMatchObject({ rate: 0.5, hits: 1, total: 2 });
    expect(score.asapRecall.rate).toBeCloseTo(1 / 3);
    expect(score.asapRecall.total).toBe(3);
  });

  it('scores exact-tier agreement apart from the queue boundary', () => {
    // Both are queued, so the queue numbers are perfect while the tier was still wrong.
    const score = scoreRun([result('today', 'whenever'), result('today', 'today')]);

    expect(score.queueRecall.rate).toBe(1);
    expect(score.tierAccuracy.rate).toBe(0.5);
  });

  it('answers an empty denominator with one rather than a division by zero', () => {
    // Nothing was called asap, so nothing was called asap wrongly — and the recall beside it is
    // what shows the miss.
    const score = scoreRun([result('asap', 'today'), result('fyi', 'fyi')]);

    expect(score.asapPrecision).toMatchObject({ rate: 1, hits: 0, total: 0 });
    expect(score.asapRecall.rate).toBe(0);
  });

  it('scores an empty run without dividing by zero', () => {
    expect(scoreRun([])).toMatchObject({
      queueRecall: { rate: 1 },
      queuePrecision: { rate: 1 },
      tierAccuracy: { rate: 1 },
    });
  });

  it('carries a 95% Wilson interval alongside every rate', () => {
    // 4/5 — the same shape the bug report hand-computed — so the score object itself, not just
    // the standalone function, is asserted against the known interval.
    const score = scoreRun([
      result('asap', 'asap'),
      result('asap', 'asap'),
      result('asap', 'asap'),
      result('asap', 'asap'),
      result('asap', 'today'),
    ]);

    expect(score.asapRecall.hits).toBe(4);
    expect(score.asapRecall.total).toBe(5);
    expect(score.asapRecall.interval.low).toBeCloseTo(0.376, 2);
    expect(score.asapRecall.interval.high).toBeCloseTo(0.964, 2);
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

describe('wilsonInterval', () => {
  it('brackets a 4/5 result the way the spec hand-computed it', () => {
    // p = 0.8, z = 1.96, z² = 3.8416
    // denom   = 1 + z²/n              = 1 + 3.8416/5      = 1.76832
    // center  = p + z²/(2n)           = 0.8 + 0.38416     = 1.18416
    // margin  = z·√(p(1-p)/n + z²/4n²) = 1.96·√(0.032 + 0.038416) = 0.52010
    // low  = (center - margin) / denom = 0.66406 / 1.76832 ≈ 0.3755
    // high = (center + margin) / denom = 1.70426 / 1.76832 ≈ 0.9638
    const interval = wilsonInterval(4, 5);

    expect(interval.low).toBeCloseTo(0.376, 2);
    expect(interval.high).toBeCloseTo(0.964, 2);
  });

  it('narrows toward the point estimate as the sample grows', () => {
    // Same 80% rate as above, ten times the sample — the interval must be visibly tighter.
    const small = wilsonInterval(4, 5);
    const large = wilsonInterval(40, 50);

    expect(large.high - large.low).toBeLessThan(small.high - small.low);
    expect(large.low).toBeGreaterThan(small.low);
    expect(large.high).toBeLessThan(small.high);
  });

  it('never reports a perfect n/n as a proven certainty', () => {
    // p = 1 makes p(1-p) = 0, so the interval collapses to [1/(1+z²/n), 1] — bounded below 1 by
    // the sample size alone, which is the whole point of reporting an interval at n=5.
    const interval = wilsonInterval(5, 5);

    expect(interval.high).toBe(1);
    expect(interval.low).toBeCloseTo(0.566, 2);
    expect(interval.low).toBeLessThan(1);
  });

  it('mirrors the all-failure case across zero', () => {
    const interval = wilsonInterval(0, 5);

    expect(interval.low).toBe(0);
    expect(interval.high).toBeCloseTo(0.434, 2);
  });

  it('reports total uncertainty rather than dividing by zero when nothing was measured', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it('stays within [0, 1] and centered near p for a mid-sized sample', () => {
    // 26/27 is the queue-recall shape called out in the bug report as reading "96.3%" — the
    // interval must still visibly widen below the point estimate even with n in the twenties.
    const interval = wilsonInterval(26, 27);

    expect(interval.low).toBeGreaterThan(0.8);
    expect(interval.low).toBeLessThan(26 / 27);
    expect(interval.high).toBeLessThanOrEqual(1);
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
