import { z } from 'zod';

import { jsonError } from '@/lib/api/responses';

const uuid = z.uuid();

/**
 * Validate that a dynamic route segment is a UUID.
 *
 * Dynamic-segment handlers (`items/[id]`, `folders/[id]`, `epics/[id]`,
 * `tasks/[id]/complete`) await `context.params` and query with the raw id. A malformed
 * id previously matched nothing and returned a misleading success (200/no-op). This
 * validates the segment up front, returning the value on success or a 400 `Response`
 * the caller early-returns. Apply ONLY where the segment is a UUID — `code/[ref]` is a
 * human ref (e.g. `ALF-42`), not a UUID, and must NOT be validated with this.
 */
export function parseUUID(value: string, field = 'id'): string | Response {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) {
    return jsonError(400, `Invalid ${field}`);
  }
  return parsed.data;
}
