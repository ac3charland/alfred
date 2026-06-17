import { withSession } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createEpicSchema, listEpicsQuerySchema } from '@/lib/api/schemas';

// ---------------------------------------------------------------------------
// GET /api/epics — list epics, optionally filtered to one project (?project=)
// ---------------------------------------------------------------------------

export const GET = withSession(async (session, request) => {
  const { supabase } = session;

  const url = new URL(request.url);
  const parsed = listEpicsQuerySchema.safeParse({
    project: url.searchParams.get('project') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, 'Invalid query parameters', parsed.error.issues);
  }

  let query = supabase.from('epics').select('*');
  if (parsed.data.project !== undefined) {
    query = query.eq('project_id', parsed.data.project);
  }
  query = query.order('created_at', { ascending: true });

  const { data, error } = await query;
  if (error) return jsonError(500, error.message);

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const parsed = createEpicSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'Invalid request body', parsed.error.issues);
  }

  const { data, error } = await supabase
    .rpc('create_epic', { p_project: parsed.data.project_id, p_name: parsed.data.name })
    .single();

  if (error) return jsonError(500, error.message);

  return jsonOk(data, 201);
});
