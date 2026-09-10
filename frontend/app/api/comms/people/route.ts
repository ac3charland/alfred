import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createPersonSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { normalizeHandle } from '@/lib/comms';
import type { CommHandleInsert, CommPersonInsert, CommPersonWithHandles } from '@/lib/types';

// ---------------------------------------------------------------------------
// GET /api/comms/people — the roster, each person carrying the handles that resolve to them
//
// One embedded read rather than two round-trips: the list is keyed on the PERSON and a handle is
// only ever meaningful next to the human it belongs to, so a roster without its addresses is
// never a shape any caller wants. Ordered by name, which is the only order the editor shows.
// ---------------------------------------------------------------------------

export const GET = withSession(async (session) => {
  const { supabase } = session;

  const { data, error } = await supabase
    .from('comm_people')
    .select('*,comm_handles(*)')
    .order('name', { ascending: true })
    .overrideTypes<CommPersonWithHandles[]>();

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data);
});

// ---------------------------------------------------------------------------
// POST /api/comms/people — add someone to the roster, with however many handles are known
//
// Two writes, person first: a handle needs a person to hang off. Each handle is normalised HERE
// rather than in the form, so `Dana@Example.com ` and `+1 (555) 010-2233` land on the stored
// forms whatever surface sent them — the resolver compares stored handles, never raw ones.
//
// A handle is unique across the whole roster (one address resolves to one human), so a collision
// is a 409. The person written a moment earlier is deleted before that answer goes out: keeping
// it would leave a handle-less duplicate behind every failed attempt, and the obvious retry —
// the same form with the handle corrected — would then create a second row for the same human.
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  const input = await parseRequestBody(request, createPersonSchema);
  if (input instanceof Response) return input;

  const insert: CommPersonInsert = { name: input.name, priority: input.priority };
  if (input.notes !== undefined) insert.notes = input.notes;

  const { data: person, error } = await supabase
    .from('comm_people')
    .insert(insert)
    .select()
    .single();

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  if (input.handles.length === 0) {
    return jsonOk({ ...person, comm_handles: [] }, 201);
  }

  const handleRows: CommHandleInsert[] = input.handles.map((handle) => ({
    person_id: person.id,
    handle: normalizeHandle(handle.handle),
    kind: handle.kind,
  }));

  const { data: handles, error: handleError } = await supabase
    .from('comm_handles')
    .insert(handleRows)
    .select();

  if (handleError) {
    await supabase.from('comm_people').delete().eq('id', person.id);
    const { status, message } = mapSupabaseError(handleError);
    return jsonError(status, message);
  }

  return jsonOk({ ...person, comm_handles: handles }, 201);
});
