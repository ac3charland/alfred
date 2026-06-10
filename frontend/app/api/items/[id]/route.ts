import { getSessionOrUnauthorized } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updateItemSchema } from '@/lib/api/schemas';
import type { ItemUpdate } from '@/lib/types';

// ---------------------------------------------------------------------------
// PATCH /api/items/[id]
// ---------------------------------------------------------------------------

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSessionOrUnauthorized();
  if (session instanceof Response) return session;

  const { id } = await context.params;
  const { supabase } = session;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const parsed = updateItemSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'Invalid request body', parsed.error.issues);
  }

  // PATCH semantics: only set the fields the caller actually provided. Building
  // the payload from defined-only fields also satisfies exactOptionalPropertyTypes
  // (zod `.optional()` yields `T | undefined`, which isn't assignable to `T?`).
  const d = parsed.data;
  const updates: ItemUpdate = {};
  if (d.title !== undefined) updates.title = d.title;
  if (d.notes !== undefined) updates.notes = d.notes;
  if (d.source_url !== undefined) updates.source_url = d.source_url;
  if (d.due_date !== undefined) updates.due_date = d.due_date;
  if (d.folder_id !== undefined) updates.folder_id = d.folder_id;
  if (d.parent_id !== undefined) updates.parent_id = d.parent_id;
  if (d.item_type !== undefined) updates.item_type = d.item_type;
  if (d.status !== undefined) updates.status = d.status;

  const { data, error } = await supabase
    .from('items')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return jsonError(500, error.message);

  return jsonOk(data);
}

// ---------------------------------------------------------------------------
// DELETE /api/items/[id]
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSessionOrUnauthorized();
  if (session instanceof Response) return session;

  const { id } = await context.params;
  const { supabase } = session;

  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) return jsonError(500, error.message);

  return jsonOk({ success: true });
}
