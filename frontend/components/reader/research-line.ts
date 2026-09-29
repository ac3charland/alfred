import type { ResearchPhase } from '@/lib/reader/research';
import type { ReaderPostListItem } from '@/lib/types';

/**
 * The line a research post shows in the gist's place until its report arrives — what is
 * happening, and what the owner can do about it. A delivered report has none: from then on the
 * row is an ordinary post and its own summary speaks.
 */

/** A session is underway (or about to be): nothing to do but wait, and the line says for how long. */
const RESEARCHING = 'Researching on the web — the report lands here, usually within the hour.';

/**
 * The clause a failed post falls back to when no reason was stored. `failed` means the Routine
 * refused (or could not be reached for) the fire, so the research never began.
 */
const GENERIC_CLAUSE = 'the research couldn’t be started';

const NO_REPORT = 'No report';

/**
 * A reason the fire route stored ("the research Routine refused alfred’s token"), as a clause
 * that a full stop of the line's own can follow — the stored text carries none, but a hand-written
 * one might.
 */
function reasonClause(post: Pick<ReaderPostListItem, 'research_error'>): string {
  const reason = post.research_error?.trim().replace(/\.+$/, '');
  return reason === undefined || reason === '' ? GENERIC_CLAUSE : reason;
}

/**
 * The line for a phase, or `undefined` when the phase has none (a delivered report, or a post that
 * is not research). The two stale phases say what was noticed, not what was stored: nothing marks a
 * post stale, so no `research_error` exists for them.
 */
export function researchLine(
  post: Pick<ReaderPostListItem, 'research_error' | 'research_attempts' | 'research_session_url'>,
  phase: ResearchPhase | undefined,
): string | undefined {
  switch (phase) {
    case 'queued':
    case 'researching': {
      return RESEARCHING;
    }
    case 'failed': {
      return `${NO_REPORT} — ${reasonClause(post)}. Retry to start a new session.`;
    }
    case 'stale-researching': {
      // "Open it" only when there is a Session link to open.
      return post.research_session_url === null
        ? `${NO_REPORT} — the session hasn’t reported back in 3 hours. Retry to start a new one.`
        : `${NO_REPORT} — the session hasn’t reported back in 3 hours. Open it, or retry to start a new one.`;
    }
    case 'stale-queued': {
      // An attempt on a queued post is a fire that was claimed but whose outcome was never
      // recorded: a session may be running, so "never started" would be a guess.
      return post.research_attempts > 0
        ? `${NO_REPORT} — this run’s start was never confirmed. Retry to start a new session.`
        : `${NO_REPORT} — the research never started. Retry to start a session.`;
    }
    case 'done':
    case undefined: {
      return undefined;
    }
  }
}
