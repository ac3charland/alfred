import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createProjectSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { parseGithubRepo } from '@/lib/code/github';
import { getProjectList } from '@/lib/data/code';
import type { ProjectInsert } from '@/lib/types';

// ---------------------------------------------------------------------------
// GET /api/projects — list all projects (oldest first, the ProjectNav order)
// ---------------------------------------------------------------------------

export const GET = withSession(async () => {
  const { data, error } = await getProjectList();
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data);
});

// ---------------------------------------------------------------------------
// POST /api/projects — create a project
//
// The body carries a GitHub URL + a 3-char key; the route derives repo_owner/repo_name
// from the URL (storing the URL too) and inserts. Key uniqueness is enforced by the DB
// `unique` constraint, which surfaces here as a 409 (via mapSupabaseError).
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  const input = await parseRequestBody(request, createProjectSchema);
  if (input instanceof Response) return input;

  const { name, github_url, key } = input;

  const repo = parseGithubRepo(github_url);
  if (repo === null) {
    return jsonError(400, 'Invalid GitHub repository URL');
  }

  const insert: ProjectInsert = {
    name,
    key,
    repo_owner: repo.owner,
    repo_name: repo.name,
    github_url,
  };

  const { data, error } = await supabase.from('projects').insert(insert).select().single();

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data, 201);
});
