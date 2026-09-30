import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import { claimResearchFire, recordResearchFire } from '@/lib/data/reader';
import type { Database } from '@/lib/database.types';
import type { ReaderPostListItem } from '@/lib/types';

import type { ResearchConfig } from './config';
import { fireResearchRoutine } from './routine';

/** What a fire reads off the post: which one, the question, and the state it was read in. */
export interface ResearchFirePost {
  id: string;
  research_brief: string;
  research_attempts: number;
  research_state: string;
}

/**
 * What came of one fire. `claimed: false` means nothing fired: another request claimed the post
 * first (no error), or the claim itself failed (its error). Otherwise the fire happened and `data`
 * / `error` are the recording's — a null row with no error is a post delivered (or deleted) while
 * the fire was in flight.
 */
export type FireAndRecordResult =
  | { claimed: false; data: null; error: PostgrestError | null }
  | { claimed: true; data: ReaderPostListItem | null; error: PostgrestError | null };

/**
 * Start one research session for a post and record what came of it — the one step dispatch and
 * retry share. Claims first, so two requests that read the same post can't both start a session
 * (and spend two runs of the Routine's daily cap); then fires; then writes the outcome: an
 * accepted fire makes the post `researching` with its session link, a refused one `failed` with
 * the reason.
 *
 * A refused fire is not an error here, only a different row. An error after the claim is the
 * WRITE's: the fire has already happened, so a caller that cannot record it must decide what to
 * tell the owner about a session that may be running.
 */
export async function fireAndRecord(
  supabase: SupabaseClient<Database>,
  config: ResearchConfig,
  post: ResearchFirePost,
): Promise<FireAndRecordResult> {
  const claim = await claimResearchFire(supabase, post.id, {
    attempts: post.research_attempts,
    state: post.research_state,
  });
  const claimError = claim.error ?? null;
  if (claimError !== null || claim.data === null) {
    return { claimed: false, data: null, error: claimError };
  }

  const outcome = await fireResearchRoutine(config, {
    id: post.id,
    research_brief: post.research_brief,
  });
  const recorded = await recordResearchFire(supabase, post.id, outcome, new Date());
  return { claimed: true, data: recorded.data, error: recorded.error ?? null };
}
