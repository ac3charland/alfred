import { toLaunchLane } from '@/lib/code/launch-lane';
import { stableSorted } from '@/lib/sort';
import type { CodeSessionLink, CodeStory } from '@/lib/types';

/**
 * The story detail's session links: which recorded sessions belong to a story, in what order, and
 * how a realtime change to `code_sessions` lands on the list the store holds.
 */

/** A `code_sessions` row as a realtime INSERT/UPDATE delivers it: any column may be absent. */
export interface CodeSessionChange {
  session_id?: string;
  ref?: string | null;
  repo?: string;
  launch_lane?: string | null;
  session_created_at?: string | null;
}

/**
 * Land one INSERT/UPDATE on the list. The slim columns the payload carried overwrite the held row's
 * (an absent one — Postgres leaves unchanged TOASTed columns out — keeps the held value); a row the
 * list lacks is added with nulls for what it didn't carry. A row with no ref names no ticket, so it
 * is dropped, as is one that can't be keyed or placed in a repo.
 */
export function landSessionChange(
  sessions: readonly CodeSessionLink[],
  change: CodeSessionChange,
): CodeSessionLink[] {
  const { session_id: sessionId } = change;
  if (sessionId === undefined) return [...sessions];
  const held = sessions.find((session) => session.session_id === sessionId);
  const rest = sessions.filter((session) => session.session_id !== sessionId);
  // An absent column (undefined) keeps the held value; a new row starts from nulls.
  const ref = change.ref === undefined ? held?.ref : change.ref;
  const repo = change.repo ?? held?.repo;
  if (ref === null || ref === undefined || repo === undefined) return rest;
  return [
    ...rest,
    {
      session_id: sessionId,
      ref,
      repo,
      launch_lane:
        change.launch_lane === undefined
          ? (held?.launch_lane ?? null)
          : toLaunchLane(change.launch_lane),
      session_created_at:
        change.session_created_at === undefined
          ? (held?.session_created_at ?? null)
          : change.session_created_at,
    },
  ];
}

/** Drop a deleted session (a DELETE payload carries only the key). */
export function dropSession(
  sessions: readonly CodeSessionLink[],
  sessionId: string | undefined,
): CodeSessionLink[] {
  return sessions.filter((session) => session.session_id !== sessionId);
}

/**
 * Newest first by start time; a session with no start time sorts last; ties break on the id. ISO
 * timestamps from Postgres share a format, but they are compared as instants all the same.
 */
function byNewest(a: CodeSessionLink, b: CodeSessionLink): number {
  const at = a.session_created_at === null ? Number.NaN : Date.parse(a.session_created_at);
  const bt = b.session_created_at === null ? Number.NaN : Date.parse(b.session_created_at);
  if (Number.isNaN(at) !== Number.isNaN(bt)) return Number.isNaN(at) ? 1 : -1;
  if (!Number.isNaN(at) && at !== bt) return bt - at;
  return a.session_id.localeCompare(b.session_id);
}

/**
 * The sessions recorded against `story`: its ref in its own repo (a ref-shaped prompt in another
 * repo is another project's ticket), newest first.
 */
export function sessionsForStory(
  sessions: readonly CodeSessionLink[],
  story: Pick<CodeStory, 'ref' | 'repo_owner' | 'repo_name'>,
): CodeSessionLink[] {
  if (story.ref === null || story.repo_owner === null || story.repo_name === null) return [];
  const repo = `${story.repo_owner}/${story.repo_name}`;
  return stableSorted(
    sessions.filter((session) => session.ref === story.ref && session.repo === repo),
    byNewest,
  );
}
