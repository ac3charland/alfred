import { resolveIngestClient, withSession } from '@/lib/api/auth';
import { parseQueryParams, parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createItemSchema, listItemsQuerySchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getItems } from '@/lib/data/items';

// ---------------------------------------------------------------------------
// GET /api/items
// ---------------------------------------------------------------------------

export const GET = withSession(async (_session, request) => {
  const query = parseQueryParams(request, listItemsQuerySchema);
  if (query instanceof Response) return query;

  const { data, error } = await getItems(query);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data);
});

// ---------------------------------------------------------------------------
// POST /api/items
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const clientResult = await resolveIngestClient(request);
  // resolveIngestClient returns a Response directly on auth failure
  if (clientResult instanceof Response) return clientResult;

  const { supabase } = clientResult;

  const input = await parseRequestBody(request, createItemSchema);
  if (input instanceof Response) return input;

  // Resolve title: use `text` as a fallback (Siri raw-capture path)
  // Stryker disable next-line StringLiteral: AT_CEILING — TS-type-safety guard, unreachable at runtime — the schema refine() guarantees title or text is present, so `input.title ?? input.text` is never undefined.
  const resolvedTitle = input.title ?? input.text ?? '';
  const resolvedRawCapture = input.raw_capture ?? input.text ?? null;

  const { data, error } = await supabase
    .from('items')
    .insert({
      title: resolvedTitle,
      notes: input.notes ?? null,
      source_url: input.source_url ?? null,
      raw_capture: resolvedRawCapture,
      item_type: input.parent_id == null ? (input.item_type ?? 'unclassified') : 'task',
      due_date: input.due_date ?? null,
      folder_id: input.folder_id ?? null,
      parent_id: input.parent_id ?? null,
      // A row with a parent_id is forced to `task`, which may never carry an intended project
      // (the DB CHECK is code-only) — null it out when a parent is present (belt-and-braces).
      intended_project_id: input.parent_id == null ? (input.intended_project_id ?? null) : null,
      status: 'active',
    })
    .select()
    .single();

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data, 201);
}
