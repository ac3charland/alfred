import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import { recordResearchFire } from '@/lib/data/reader';
import type { Database } from '@/lib/database.types';
import type { ReaderPostListItem } from '@/lib/types';

import type { ResearchConfig } from './config';
import { fireResearchRoutine } from './routine';

/** What a fire reads off the post: which one, the question, and how many fires it has had. */
export interface ResearchFirePost {
  id: string;
  research_brief: string;
  research_attempts: number;
}

/**
 * Start one research session for a post and record what came of it — the one step dispatch and
 * retry share. Fires first, then writes: an accepted fire makes the post `researching` with its
 * session link, a refused one `failed` with the reason, and either counts as an attempt.
 *
 * A refused fire is not an error here, only a different row. The error this returns is the WRITE's:
 * the fire has already happened, so a caller that cannot record it must decide what to tell the
 * owner about a session that may be running.
 */
export async function fireAndRecord(
  supabase: SupabaseClient<Database>,
  config: ResearchConfig,
  post: ResearchFirePost,
): Promise<{ data: ReaderPostListItem | null; error: PostgrestError | null }> {
  const outcome = await fireResearchRoutine(config, {
    id: post.id,
    research_brief: post.research_brief,
  });
  return recordResearchFire(supabase, post.id, outcome, post.research_attempts, new Date());
}
