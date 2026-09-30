import { z } from 'zod';

import { resolveLedgerClient } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { LEDGER_ROWS_MAX, ledgerRowsSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';

// ---------------------------------------------------------------------------
// POST /api/code/sessions — upsert a batch of `code_sessions` rows (the session-ledger backfill).
//
// Body `{ rows: LedgerRow[] }`, 1–100 rows. Every row lands through `upsert_code_sessions`, one
// statement that refreshes each column except a recorded prompt (the rule lives in SQL, so no
// client can bypass it), and answers `{ upserted, kept_recorded }`.
//
// The ledger key OR the owner's session (`resolveLedgerClient`); the ingest key is refused.
// ---------------------------------------------------------------------------

/** The envelope, checked first so an oversized batch answers 413 before any row is judged. */
const envelopeSchema = z.strictObject({ rows: z.array(z.unknown()) });

export async function POST(request: Request): Promise<Response> {
  const supabase = await resolveLedgerClient(request);
  if (supabase instanceof Response) return supabase;

  const envelope = await parseRequestBody(request, envelopeSchema);
  if (envelope instanceof Response) return envelope;
  if (envelope.rows.length === 0) return jsonError(400, 'rows must hold at least one row');
  if (envelope.rows.length > LEDGER_ROWS_MAX) {
    return jsonError(413, `rows holds more than ${String(LEDGER_ROWS_MAX)} rows`);
  }

  const rows = ledgerRowsSchema.safeParse(envelope.rows);
  if (!rows.success) return jsonError(400, 'Invalid ledger rows', rows.error.issues);

  const { data, error } = await supabase.rpc('upsert_code_sessions', { p_rows: rows.data });
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  const [counts] = data;
  return jsonOk({ upserted: counts?.upserted ?? 0, kept_recorded: counts?.kept_recorded ?? 0 });
}
