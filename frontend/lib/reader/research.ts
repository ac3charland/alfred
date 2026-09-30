import type { ReaderPostListItem } from '@/lib/types';

/**
 * Where a research post is in its life, derived at read time from the stored state and the clock.
 *
 * The database stores `queued | researching | done | failed`. Two more phases exist only here:
 * a post whose fire never happened (the dispatch route died between creating the post and firing
 * the Routine) and a post whose session never reported back. Nothing marks either — no cron, no
 * Worker leg — so the row that draws "No report" and the retry route that decides whether a retry
 * is allowed both ask this one function, and cannot disagree.
 */
export type ResearchPhase =
  | 'queued'
  | 'researching'
  | 'done'
  | 'failed'
  | 'stale-queued'
  | 'stale-researching';

/** How long a post may sit queued before its fire is presumed lost: ten minutes. */
export const RESEARCH_QUEUED_STALE_MS = 10 * 60_000;

/** How long a session may run before it is presumed dead: three hours after its accepted fire. */
export const RESEARCH_RUN_STALE_MS = 3 * 60 * 60_000;

/** Whether a post is a research report (or the question waiting for one). */
export function isResearchPost(post: Pick<ReaderPostListItem, 'source'>): boolean {
  return post.source === 'research';
}

/** The phase a research post is in at `now`, or `undefined` for any other post. */
export function researchPhase(
  post: Pick<ReaderPostListItem, 'source' | 'research_state' | 'created_at' | 'research_fired_at'>,
  now: Date,
): ResearchPhase | undefined {
  if (!isResearchPost(post)) return undefined;
  const since = (iso: string): number => now.getTime() - new Date(iso).getTime();
  switch (post.research_state) {
    case 'queued': {
      return since(post.created_at) > RESEARCH_QUEUED_STALE_MS ? 'stale-queued' : 'queued';
    }
    case 'researching': {
      const firedAt = post.research_fired_at ?? post.created_at;
      return since(firedAt) > RESEARCH_RUN_STALE_MS ? 'stale-researching' : 'researching';
    }
    case 'done': {
      return 'done';
    }
    default: {
      // `failed`, and anything the CHECK would refuse — a row that can't be read as running or
      // delivered is one the owner should be able to retry.
      return 'failed';
    }
  }
}

/** The phases a retry may start from: a refused fire, or a run presumed lost. */
const RETRYABLE_PHASES: ReadonlySet<ResearchPhase> = new Set([
  'failed',
  'stale-queued',
  'stale-researching',
]);

/** Whether Retry research may run: only a failed or stale post, never one still in flight. */
export function researchRetryable(phase: ResearchPhase | undefined): boolean {
  return phase !== undefined && RETRYABLE_PHASES.has(phase);
}
