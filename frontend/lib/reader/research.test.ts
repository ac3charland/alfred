import { makeReaderPost, makeResearchPost } from '@/lib/reader/fixtures';

import {
  RESEARCH_QUEUED_STALE_MS,
  RESEARCH_RUN_STALE_MS,
  isResearchPost,
  researchPhase,
  researchRetryable,
} from './research';

const NOW = new Date('2026-09-29T12:00:00.000Z');

/** An ISO instant `ms` before {@link NOW}. */
function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

describe('isResearchPost', () => {
  it('is true only for a research post', () => {
    expect(isResearchPost(makeResearchPost())).toBe(true);
    expect(isResearchPost(makeReaderPost('pub-1'))).toBe(false);
  });
});

describe('researchPhase', () => {
  it('is undefined for a post that is not research', () => {
    expect(researchPhase(makeReaderPost('pub-1'), NOW)).toBeUndefined();
  });

  it('reads a fresh queued post as queued, and one queued over ten minutes as stale', () => {
    const fresh = makeResearchPost({
      research_state: 'queued',
      research_fired_at: null,
      created_at: ago(RESEARCH_QUEUED_STALE_MS),
    });
    expect(researchPhase(fresh, NOW)).toBe('queued');
    const stale = { ...fresh, created_at: ago(RESEARCH_QUEUED_STALE_MS + 1) };
    expect(researchPhase(stale, NOW)).toBe('stale-queued');
  });

  it('reads a researching post as researching for three hours after its fire, then stale', () => {
    const running = makeResearchPost({
      research_state: 'researching',
      created_at: ago(RESEARCH_RUN_STALE_MS * 2),
      research_fired_at: ago(RESEARCH_RUN_STALE_MS),
    });
    expect(researchPhase(running, NOW)).toBe('researching');
    const stale = { ...running, research_fired_at: ago(RESEARCH_RUN_STALE_MS + 1) };
    expect(researchPhase(stale, NOW)).toBe('stale-researching');
  });

  it('falls back to created_at for a researching post with no fire stamp', () => {
    const post = makeResearchPost({
      research_state: 'researching',
      research_fired_at: null,
      created_at: ago(RESEARCH_RUN_STALE_MS + 1),
    });
    expect(researchPhase(post, NOW)).toBe('stale-researching');
  });

  it('passes failed and done straight through, however old', () => {
    const old = ago(RESEARCH_RUN_STALE_MS * 10);
    expect(
      researchPhase(makeResearchPost({ research_state: 'failed', research_fired_at: old }), NOW),
    ).toBe('failed');
    expect(
      researchPhase(makeResearchPost({ research_state: 'done', research_delivered_at: old }), NOW),
    ).toBe('done');
  });

  it('pins the two thresholds', () => {
    expect(RESEARCH_QUEUED_STALE_MS).toBe(10 * 60_000);
    expect(RESEARCH_RUN_STALE_MS).toBe(3 * 60 * 60_000);
  });
});

describe('researchRetryable', () => {
  it.each([
    ['failed', true],
    ['stale-queued', true],
    ['stale-researching', true],
    ['queued', false],
    ['researching', false],
    ['done', false],
    [undefined, false],
  ] as const)('%s → %s', (phase, expected) => {
    expect(researchRetryable(phase)).toBe(expected);
  });
});
