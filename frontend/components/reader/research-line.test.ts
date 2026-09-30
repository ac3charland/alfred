import { makeResearchPost } from '@/lib/reader/fixtures';
import type { ResearchPhase } from '@/lib/reader/research';

import { researchLine } from './research-line';

describe('researchLine', () => {
  it.each<ResearchPhase>(['queued', 'researching'])(
    'says the report is on its way while the post is %s',
    (phase) => {
      expect(researchLine(makeResearchPost(), phase)).toBe(
        'Researching on the web — the report lands here, usually within the hour.',
      );
    },
  );

  it('says why a refused fire produced no report, in the reason the fire was refused for', () => {
    const post = makeResearchPost({
      research_state: 'failed',
      research_error: 'the research Routine refused alfred’s token',
    });

    expect(researchLine(post, 'failed')).toBe(
      'No report — the research Routine refused alfred’s token. Retry to start a new session.',
    );
  });

  it('does not double the full stop when the stored reason already ends with one', () => {
    const post = makeResearchPost({
      research_state: 'failed',
      research_error: 'the research Routine couldn’t be reached. ',
    });

    expect(researchLine(post, 'failed')).toBe(
      'No report — the research Routine couldn’t be reached. Retry to start a new session.',
    );
  });

  it.each([null, '', ' '.repeat(3)])(
    'falls back to a generic clause when the reason is %j',
    (reason) => {
      const post = makeResearchPost({ research_state: 'failed', research_error: reason });

      expect(researchLine(post, 'failed')).toBe(
        'No report — the research couldn’t be started. Retry to start a new session.',
      );
    },
  );

  it('says a silent session has not reported back in three hours', () => {
    expect(researchLine(makeResearchPost(), 'stale-researching')).toBe(
      'No report — the session hasn’t reported back in 3 hours. Open it, or retry to start a new one.',
    );
  });

  it('offers only the retry for a silent session with no link to open', () => {
    const post = makeResearchPost({ research_session_url: null });

    expect(researchLine(post, 'stale-researching')).toBe(
      'No report — the session hasn’t reported back in 3 hours. Retry to start a new one.',
    );
  });

  it('says a post no fire ever reached means the research never started', () => {
    const post = makeResearchPost({ research_state: 'queued', research_attempts: 0 });

    expect(researchLine(post, 'stale-queued')).toBe(
      'No report — the research never started. Retry to start a session.',
    );
  });

  it('does not claim "never started" when a fire was made but its outcome was never recorded', () => {
    // An attempt on a queued post is a claim whose fire may have started a session that is still
    // running — the line must not tell the owner it never happened.
    const post = makeResearchPost({ research_state: 'queued', research_attempts: 1 });

    expect(researchLine(post, 'stale-queued')).toBe(
      'No report — this run’s start was never confirmed. Retry to start a new session.',
    );
  });

  it('has no line for a delivered report or a post that is not research', () => {
    expect(researchLine(makeResearchPost({ research_state: 'done' }), 'done')).toBeUndefined();
    expect(researchLine(makeResearchPost(), undefined)).toBeUndefined();
  });
});
