import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createRubricVersionSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';

// ---------------------------------------------------------------------------
// GET /api/comms/rubric — every version, newest first
//
// The whole history, not just the current text: a verdict names the version that produced it, so
// "why did it say that" is only answerable while the version it points at is still readable. The
// table is a handful of rows the owner wrote by hand, so reading it whole costs nothing.
// ---------------------------------------------------------------------------

export const GET = withSession(async (session) => {
  const { supabase } = session;

  const { data, error } = await supabase
    .from('comm_rubrics')
    .select('*')
    .order('version', { ascending: false });

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data);
});

// ---------------------------------------------------------------------------
// POST /api/comms/rubric — save an edit as a NEW version
//
// The table is append-only and this route never updates a row: destroying the text a verdict was
// stamped against would make that verdict unreconstructable, which is the whole reason the rubric
// is versioned. Saving also sweeps nothing — every message already judged keeps its judgment.
//
// The version number is the server's to assign; the caller never states one. Read-then-insert is
// safe here because there is one owner and the `unique (version)` index is the referee: two saves
// racing produce a 409 on the loser rather than two rows claiming the same version.
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  const input = await parseRequestBody(request, createRubricVersionSchema);
  if (input instanceof Response) return input;

  const { data: latest, error: readError } = await supabase
    .from('comm_rubrics')
    .select('version')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readError) {
    const { status, message } = mapSupabaseError(readError);
    return jsonError(status, message);
  }

  const { data, error } = await supabase
    .from('comm_rubrics')
    .insert({ version: (latest?.version ?? 0) + 1, body: input.body })
    .select()
    .single();

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data, 201);
});
