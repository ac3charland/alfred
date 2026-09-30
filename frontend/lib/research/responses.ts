import 'server-only';

import { jsonError } from '@/lib/api/responses';

/**
 * Shared route answers for the two research routes that need a configured Routine (dispatch and
 * retry), so the two never drift on wording.
 */

/** A var unset on this deployment — 501, before anything is read. */
export function researchUnconfiguredResponse(): Response {
  return jsonError(501, 'Research is not configured on this deployment');
}
