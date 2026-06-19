import { withSession } from '@/lib/api/auth';
import { parseQueryParams, parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createEpicSchema, listEpicsQuerySchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getEpicList } from '@/lib/data/code';

// ---------------------------------------------------------------------------
// GET /api/epics — list epics, optionally filtered to one project (?project=)
// ---------------------------------------------------------------------------

export const GET = withSession(async (_session, request) => {
  const query = parseQueryParams(request, listEpicsQuerySchema);
  if (query instanceof Response) return query;

  const { data, error } = await getEpicList(query);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data);
});

// ---------------------------------------------------------------------------
// POST /api/epics — create an epic via the create_epic RPC
//
// The RPC allocates the shared per-project ref counter and denormalizes KEY-N, so the
// epic is never client-minted. Returns the inserted `epics` row.
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  const input = await parseRequestBody(request, createEpicSchema);
  if (input instanceof Response) return input;

  const { data, error } = await supabase
    .rpc('create_epic', { p_project: input.project_id, p_name: input.name })
    .single();

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data, 201);
});
