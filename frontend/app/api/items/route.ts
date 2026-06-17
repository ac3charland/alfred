import { resolveIngestClient, withSession } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createItemSchema, listItemsQuerySchema } from '@/lib/api/schemas';

// ---------------------------------------------------------------------------
// GET /api/items
// ---------------------------------------------------------------------------

export const GET = withSession(async (session, request) => {
  const { supabase } = session;

  const url = new URL(request.url);
  const rawQuery = {
    folder: url.searchParams.get('folder') ?? undefined,
    inbox: url.searchParams.get('inbox') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
  };

  const parsed = listItemsQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return jsonError(400, 'Invalid query parameters', parsed.error.issues);
  }

  const { folder, inbox, status } = parsed.data;

  let query = supabase.from('items').select('*');

  if (inbox === true) {
    // Inbox: items with no folder assigned — must use .is(), not .eq()
    query = query.is('folder_id', null);
  } else if (folder !== undefined) {
    query = query.eq('folder_id', folder);
  }

  const resolvedStatus = status ?? 'active';
  if (resolvedStatus !== 'all') {
    query = query.eq('status', resolvedStatus);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) return jsonError(500, error.message);

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const parsed = createItemSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'Invalid request body', parsed.error.issues);
  }

  const input = parsed.data;

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
      status: 'active',
    })
    .select()
    .single();

  if (error) return jsonError(500, error.message);

  return jsonOk(data, 201);
}
