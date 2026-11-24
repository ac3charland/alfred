import { resolveLedgerClient } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { recordedRowSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { laneOfPrompt } from '@/lib/code/launch-lane';

// ---------------------------------------------------------------------------
// POST /api/code/sessions/record — one write from the session-ledger hook.
//
// Body `RecordedRow`: a `session-start` (identity and start commit), a `prompt` (the session's
// first prompt, its skills and ref) or a `stop` (prompt, skills, usage so far), strict, so a cost
// or any unknown key is a 400. A write carrying a prompt gains the launch lane that prompt reads
// as (`laneOfPrompt`), so the hook never needs a copy of the launch prompts. The row lands through
// `record_code_session`, which decides per column whether the hook or the backfill owns it (the
// rules live in SQL, so no client can bypass them) and prices the usage itself. Answers
// `{ inserted }`: whether the call created the row.
//
// The ledger key OR the owner's session (`resolveLedgerClient`); the ingest key is refused.
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const supabase = await resolveLedgerClient(request);
  if (supabase instanceof Response) return supabase;

  const row = await parseRequestBody(request, recordedRowSchema);
  if (row instanceof Response) return row;

  const withLane =
    typeof row.prompt === 'string' ? { ...row, launch_lane: laneOfPrompt(row.prompt) } : row;
  const { data, error } = await supabase.rpc('record_code_session', { p_row: withLane });
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  const [first] = data;
  return jsonOk({ inserted: first?.inserted ?? false });
}
