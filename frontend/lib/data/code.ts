import type { PostgrestError } from '@supabase/supabase-js';
import 'server-only';

import type { ListEpicsQuery } from '@/lib/api/schemas';
import { createClient } from '@/lib/supabase/server';
import type { CodeStory, Epic, Project } from '@/lib/types';

/**
 * Server-only read layer for the Software Factory (the `code` module).
 *
 * Mirrors `lib/data/items.ts`: the whole code dataset — projects, epics, and the
 * flattened code-story rows — is fetched once at the (code) layout and seeded into the
 * CodeProvider store; the board derives each project's swimlanes client-side. Volume is
 * small (single user), so a fetch-all beats per-project round-trips (see the
 * data-flow skill). Client components never import this — they read the store.
 */

/** All projects, oldest first (the ProjectNav display order). */
export async function getProjects(): Promise<Project[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: true });
  return data ?? [];
}

/** All epics across every project, oldest first. The board filters by project_id. */
export async function getEpics(): Promise<Epic[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('epics')
    .select('*')
    .order('created_at', { ascending: true });
  return data ?? [];
}

/**
 * Every code story (the flattened `v_code_stories` view), ordered by ref number.
 *
 * `v_code_stories` is a view, so Postgres carries no NOT NULL metadata and the generated
 * type makes every column nullable. The view's inner joins guarantee a fully-resolved row
 * for every story it returns, so override the result back to `CodeStory` (the same gotcha
 * handled for `task_items`; see the supabase skill).
 */
export async function getCodeStories(): Promise<CodeStory[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('v_code_stories')
    .select('*')
    .order('ref_number', { ascending: true })
    .overrideTypes<CodeStory[]>();
  return data ?? [];
}

// ---------------------------------------------------------------------------
// API list readers — parallel to the seed readers above, but return the raw
// Supabase `{ data, error }` so the GET route handlers can map the error to a
// status (`mapSupabaseError`). The seed readers (getProjects/getEpics/
// getCodeStories) keep their graceful `[]`-on-null fallback for the layout.
// ---------------------------------------------------------------------------

/** The GET /api/projects read: all projects, oldest first, with the raw error. */
export async function getProjectList(): Promise<{
  data: Project[] | null;
  error: PostgrestError | null;
}> {
  const supabase = await createClient();
  return supabase.from('projects').select('*').order('created_at', { ascending: true });
}

/**
 * The GET /api/epics read: all epics oldest-first, optionally filtered to one project
 * (`?project=`), with the raw error for the route to map.
 */
export async function getEpicList(query: ListEpicsQuery): Promise<{
  data: Epic[] | null;
  error: PostgrestError | null;
}> {
  const supabase = await createClient();
  let builder = supabase.from('epics').select('*');
  if (query.project !== undefined) {
    builder = builder.eq('project_id', query.project);
  }
  return builder.order('created_at', { ascending: true });
}

/** The GET /api/code read: every code story (the `v_code_stories` view), with the raw error. */
export async function getCodeStoryList(): Promise<{
  data: CodeStory[] | null;
  error: PostgrestError | null;
}> {
  const supabase = await createClient();
  return supabase
    .from('v_code_stories')
    .select('*')
    .order('ref_number', { ascending: true })
    .overrideTypes<CodeStory[]>();
}
