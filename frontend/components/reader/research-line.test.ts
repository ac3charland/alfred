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

  it('says a fire that never happened means the research never started', () => {
    expect(researchLine(makeResearchPost({ research_state: 'queued' }), 'stale-queued')).toBe(
      'No report — the research never started. Retry to start a session.',
    );
  });

  it('has no line for a delivered report or a post that is not research', () => {
    expect(researchLine(makeResearchPost({ research_state: 'done' }), 'done')).toBeUndefined();
    expect(researchLine(makeResearchPost(), undefined)).toBeUndefined();
  });
});
