/**
 * Write `code_items` (story) and `epics` rows from the Worker via Supabase's PostgREST endpoint.
 *
 * We hit the REST API with raw `fetch` rather than bundling `@supabase/supabase-js` — it keeps the
 * Worker tiny and needs no `nodejs_compat`. The Worker authenticates with the
 * SERVICE_ROLE key, which bypasses RLS — that is the trusted webhook ingress the schema's RLS
 * comment calls out. Keep that key a Worker secret; it must never reach the browser.
 */
import type { TicketUpdate } from './transitions';

export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

/** The extra spec-snapshot columns the Worker writes after fetching the file. */
export interface SpecSnapshot {
  spec_markdown: string;
  spec_sha: string;
}

function restUrl(env: SupabaseEnv, table: string, ref: string): string {
  return `${env.SUPABASE_URL}/rest/v1/${table}?ref=eq.${encodeURIComponent(ref)}`;
}

function headers(env: SupabaseEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    // Return the affected rows so callers can tell whether the ref actually matched a story.
    Prefer: 'return=representation',
  };
}

/**
 * PATCH one ref-keyed row of `table`. Returns the number of rows updated — 0 means the ref
 * isn't a row we track (a PR for some other repo/ticket), which the caller treats as a benign
 * no-op. Throws on a non-2xx response so the handler can log a real failure.
 *
 * `code_items` and `epics` both key on `ref` (from one shared per-project counter) and name their
 * spec/PR columns identically, so the two exported wrappers below differ only in the table.
 */
async function patchByRef(
  env: SupabaseEnv,
  table: string,
  ref: string,
  updates: TicketUpdate | SpecSnapshot,
): Promise<number> {
  const response = await fetch(restUrl(env, table, ref), {
    method: 'PATCH',
    headers: headers(env),
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Supabase PATCH ${table} (${ref}) failed: ${String(response.status)} ${detail}`,
    );
  }

  const rows = await response.json<unknown[]>();
  return rows.length;
}

/** PATCH a `code_items` (story) row by its `ref`. */
export function patchCodeItem(
  env: SupabaseEnv,
  ref: string,
  updates: TicketUpdate | SpecSnapshot,
): Promise<number> {
  return patchByRef(env, 'code_items', ref, updates);
}

/** PATCH an `epics` row by its `ref` — the epic-refinement phase's target. */
export function patchEpic(
  env: SupabaseEnv,
  ref: string,
  updates: TicketUpdate | SpecSnapshot,
): Promise<number> {
  return patchByRef(env, 'epics', ref, updates);
}
