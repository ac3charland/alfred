import { resolveLedgerClient } from '@/lib/api/auth';
import { parseQueryParams } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { ledgerInputsQuerySchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { findProjectByRepo, listLedgerEpics, listLedgerStories } from '@/lib/data/code';

// ---------------------------------------------------------------------------
// GET /api/code/ledger-inputs?repo=<owner>/<name> — everything the session-ledger backfill needs
// to replay a historical launch prompt: the project whose repo matches, its stories (title and
// notes included, the prompt's context) and its epics.
//
// The ledger key OR the owner's session (`resolveLedgerClient`); the ingest key is refused. The
// backfill session reads untrusted text, so its credential reaches only the two ledger routes.
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const supabase = await resolveLedgerClient(request);
  if (supabase instanceof Response) return supabase;

  const query = parseQueryParams(request, ledgerInputsQuerySchema);
  if (query instanceof Response) return query;
  const [repoOwner = '', repoName = ''] = query.repo.split('/');

  const project = await findProjectByRepo(supabase, repoOwner, repoName);
  if (project.error) {
    const { status, message } = mapSupabaseError(project.error);
    return jsonError(status, message);
  }
  if (project.data === null) return jsonError(404, `No project for ${query.repo}`);

  const [stories, epics] = await Promise.all([
    listLedgerStories(supabase, project.data.id),
    listLedgerEpics(supabase, project.data.id),
  ]);
  const error = stories.error ?? epics.error;
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk({ project: project.data, stories: stories.data ?? [], epics: epics.data ?? [] });
}
