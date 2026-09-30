import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import type { ListEpicsQuery } from '@/lib/api/schemas';
import type { Database } from '@/lib/database.types';
import type { MeasuredProject } from '@/lib/github/config';
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
 * Every project's repo, oldest first — the Dashboard's GitHub measurements measure exactly
 * these, less any the owner excluded from the PR ratio (the flag rides along for that). Oldest
 * first is the order `projectColorFor` indexes, so the ratio bar's left-to-right order is its
 * colour order.
 *
 * Unlike the readers around it, this takes the Supabase client rather than building a cookie
 * one: its routes also answer the ingest API key, whose caller has no cookie and is served by
 * the admin client (`resolveIngestClient`).
 */
export async function listProjectRepos(supabase: SupabaseClient<Database>): Promise<{
  data: MeasuredProject[] | null;
  error: PostgrestError | null;
}> {
  return supabase
    .from('projects')
    .select('name, repo_owner, repo_name, exclude_from_pr_ratio')
    .order('created_at', { ascending: true });
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

// ---------------------------------------------------------------------------
// Session-ledger inputs — what the backfill replays historical launch prompts against. Takes the
// client like `listProjectRepos`: the route also answers the ledger key, served by the admin
// client.
//
// The spec snapshots (`spec_markdown`) are left out of both reads. No launch prompt reads them,
// git holds every spec byte-for-byte, and a whole project's snapshots would push the response
// past what a serverless function may return.
// ---------------------------------------------------------------------------

/** A code story as the ledger reads it: the view row without its spec snapshot. */
export type LedgerStory = Omit<CodeStory, 'spec_markdown'>;
/** An epic as the ledger reads it: the row without its spec snapshot. */
export type LedgerEpic = Omit<Epic, 'spec_markdown'>;

const LEDGER_STORY_COLUMNS = [
  'item_id',
  'item_created_at',
  'title',
  'notes',
  'source_url',
  'project_id',
  'project_key',
  'project_name',
  'repo_owner',
  'repo_name',
  'epic_id',
  'epic_name',
  'epic_ref',
  'epic_spec_path',
  'epic_archived_at',
  'ref',
  'ref_number',
  'factory_state',
  'lane',
  'priority',
  'requires_refinement',
  'blocked_from',
  'blocked_reason',
  'spec_path',
  'spec_sha',
  'refinement_pr_url',
  'implementation_pr_url',
  'code_created_at',
  'code_updated_at',
].join(', ');

const LEDGER_EPIC_COLUMNS = [
  'id',
  'project_id',
  'name',
  'notes',
  'ref',
  'ref_number',
  'archived_at',
  'created_at',
  'refinement_pr_url',
  'spec_path',
  'spec_sha',
].join(', ');

/** The project whose repo is `owner/name`, or `null` data when none is. */
export async function findProjectByRepo(
  supabase: SupabaseClient<Database>,
  repoOwner: string,
  repoName: string,
): Promise<{ data: Project | null; error: PostgrestError | null }> {
  return supabase
    .from('projects')
    .select('*')
    .eq('repo_owner', repoOwner)
    .eq('repo_name', repoName)
    .maybeSingle();
}

/** Every story in one project, deleted-or-done included, by ref number. */
export async function listLedgerStories(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<{ data: LedgerStory[] | null; error: PostgrestError | null }> {
  return supabase
    .from('v_code_stories')
    .select(LEDGER_STORY_COLUMNS)
    .eq('project_id', projectId)
    .order('ref_number', { ascending: true })
    .overrideTypes<LedgerStory[], { merge: false }>();
}

/** Every epic in one project, archived included, by ref number. */
export async function listLedgerEpics(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<{ data: LedgerEpic[] | null; error: PostgrestError | null }> {
  return supabase
    .from('epics')
    .select(LEDGER_EPIC_COLUMNS)
    .eq('project_id', projectId)
    .order('ref_number', { ascending: true })
    .overrideTypes<LedgerEpic[], { merge: false }>();
}
