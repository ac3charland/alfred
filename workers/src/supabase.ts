/**
 * Write `code_items` rows from the Worker via Supabase's PostgREST endpoint (code-module §13.2/§13.3).
 *
 * We hit the REST API with raw `fetch` rather than bundling `@supabase/supabase-js` — it keeps the
 * Worker tiny and needs no `nodejs_compat` (§13.4). The Worker authenticates with the
 * SERVICE_ROLE key, which bypasses RLS — that is the trusted webhook ingress the schema's RLS
 * comment calls out (§4.4). Keep that key a Worker secret; it must never reach the browser.
 */
import type { TicketUpdate } from './transitions';

export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

/** The extra spec-snapshot columns the Worker writes after fetching the file (§13.3). */
export interface SpecSnapshot {
  spec_markdown: string;
  spec_sha: string;
}

function restUrl(env: SupabaseEnv, ref: string): string {
  return `${env.SUPABASE_URL}/rest/v1/code_items?ref=eq.${encodeURIComponent(ref)}`;
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
 * PATCH a `code_items` row by its `ref`. Returns the number of rows updated — 0 means the ref
 * isn't a story we track (a PR for some other repo/ticket), which the caller treats as a benign
 * no-op. Throws on a non-2xx response so the handler can log a real failure.
 */
export async function patchCodeItem(
  env: SupabaseEnv,
  ref: string,
  updates: TicketUpdate | SpecSnapshot,
): Promise<number> {
  const response = await fetch(restUrl(env, ref), {
    method: 'PATCH',
    headers: headers(env),
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Supabase PATCH code_items (${ref}) failed: ${String(response.status)} ${detail}`,
    );
  }

  const rows = await response.json<unknown[]>();
  return rows.length;
}
