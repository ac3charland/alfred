import { requireSession } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createFolderSchema } from '@/lib/api/schemas';

// ---------------------------------------------------------------------------
// GET /api/folders
// ---------------------------------------------------------------------------

export async function GET(): Promise<Response> {
  const session = await requireSession();
  if (!session) return jsonError(401, 'Unauthorized');

  const { supabase } = session;

  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) return jsonError(500, error.message);

  return jsonOk(data);
}

// ---------------------------------------------------------------------------
// POST /api/folders
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const session = await requireSession();
  if (!session) return jsonError(401, 'Unauthorized');

  const { supabase } = session;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const parsed = createFolderSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'Invalid request body', parsed.error.issues);
  }

  const { data, error } = await supabase
    .from('folders')
    .insert({ name: parsed.data.name })
    .select()
    .single();

  if (error) return jsonError(500, error.message);

  return jsonOk(data, 201);
}
