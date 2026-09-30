import type { PushResult } from './report.ts';
import type { LedgerRow } from './types.ts';

/** Rows per request — POST /api/code/sessions accepts 1–100. */
export const CHUNK_SIZE = 100;

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Upsert every row through POST /api/code/sessions, in chunks, stopping at the first failed
 * chunk (the upsert is idempotent, so a re-run picks up where this left off). Sends
 * `Authorization` only when a key is given; otherwise the environment's proxy adds it.
 */
export async function pushRows(
  rows: readonly LedgerRow[],
  {
    baseUrl,
    key,
    fetchFn = fetch,
  }: { baseUrl: string; key?: string | undefined; fetchFn?: FetchLike },
): Promise<PushResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key !== undefined && key !== '') headers['authorization'] = `Bearer ${key}`;
  const url = new URL('/api/code/sessions', baseUrl).toString();

  const result: PushResult = { pushed: 0, upserted: 0, kept_recorded: 0 };
  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);
    const response = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rows: chunk }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `chunk at row ${String(start)} failed with ${String(response.status)}: ${text.slice(0, 500)}`,
      );
    }
    const counts = JSON.parse(text) as { upserted: number; kept_recorded: number };
    result.pushed += chunk.length;
    result.upserted += counts.upserted;
    result.kept_recorded += counts.kept_recorded;
  }
  return result;
}
