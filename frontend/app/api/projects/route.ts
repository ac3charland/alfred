import { withSession } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createProjectSchema } from '@/lib/api/schemas';
import { parseGithubRepo } from '@/lib/code/github';
import type { ProjectInsert } from '@/lib/types';

// ---------------------------------------------------------------------------
// GET /api/projects — list all projects (oldest first, the ProjectNav order)
// ---------------------------------------------------------------------------

export const GET = withSession(async (session) => {
  const { supabase } = session;

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) return jsonError(500, error.message);

  return jsonOk(data);
});

// ---------------------------------------------------------------------------
// POST /api/projects — create a project (§8.1)
//
// The body carries a GitHub URL + a 3-char key; the route derives repo_owner/repo_name
// from the URL (storing the URL too) and inserts. Key uniqueness is enforced by the DB
// `unique` constraint, which surfaces here as a 409.
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'Invalid request body', parsed.error.issues);
  }

  const { name, github_url, key } = parsed.data;

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
    // A duplicate key (or repo_owner/repo_name pair) trips a unique constraint → 409.
    if (error.code === '23505') return jsonError(409, error.message);
    return jsonError(500, error.message);
  }

  return jsonOk(data, 201);
});
