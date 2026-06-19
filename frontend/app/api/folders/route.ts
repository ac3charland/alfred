import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createFolderSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getFolderList } from '@/lib/data/folders';

// ---------------------------------------------------------------------------
// GET /api/folders
// ---------------------------------------------------------------------------

export const GET = withSession(async () => {
  const { data, error } = await getFolderList();
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data);
});

// ---------------------------------------------------------------------------
// POST /api/folders
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  const input = await parseRequestBody(request, createFolderSchema);
  if (input instanceof Response) return input;

  const { data, error } = await supabase
    .from('folders')
    .insert({ name: input.name })
    .select()
    .single();

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data, 201);
});
