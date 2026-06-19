import type { z } from 'zod';

import { jsonError } from '@/lib/api/responses';

/**
 * Parse + validate a Route Handler's JSON request body against a Zod schema.
 *
 * Replaces the `try { await request.json() } catch { 400 }` + `safeParse` block that
 * was copy-pasted across every POST/PATCH handler. Returns the parsed data on success,
 * or a 400 `Response` the caller early-returns:
 *
 *   - body is not valid JSON   → 400 `{ error: 'Invalid JSON body' }`
 *   - schema validation fails  → 400 `{ error: errorMessage, details: issues }`
 *
 * Callers branch on `result instanceof Response`.
 */
export async function parseRequestBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  errorMessage = 'Invalid request body',
): Promise<T | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, errorMessage, parsed.error.issues);
  }

  return parsed.data;
}

/**
 * Parse + validate a Route Handler's URL query string against a Zod schema.
 *
 * Replaces the `new URL(request.url)` → raw-object → `safeParse` block in the GET
 * handlers. Only the params actually present in the query string are passed to the
 * schema, so an absent key parses as `undefined` (matching the old `get(k) ?? undefined`
 * behaviour). Returns the parsed data, or a 400 `Response`:
 *
 *   - schema validation fails → 400 `{ error: 'Invalid query parameters', details: issues }`
 */
export function parseQueryParams<T>(request: Request, schema: z.ZodType<T>): T | Response {
  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams);

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Invalid query parameters', parsed.error.issues);
  }

  return parsed.data;
}
