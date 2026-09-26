import { jsonError } from '@/lib/api/responses';

import type { WikiWriteError } from './commit';

/**
 * Shared route answers for the wiki's two send routes (a Reader "send ideas" and an Inbox "send
 * items"), so the two never drift on wording — the Reader store toasts these sentences verbatim.
 */

/** No writer on this deployment (the Work instance, or Personal with a var unset) — 501. */
export function wikiUnconfiguredResponse(): Response {
  return jsonError(501, 'The wiki is not configured on this deployment');
}

/**
 * Map a failed commit to the route's answer. `busy` (main kept moving across every retry) is a
 * 503 — the caller can try again shortly. Every other kind — `unauthorized`, `rejected`,
 * `unreachable` — is a 502: GitHub refused the request as made, or never fully answered, and
 * retrying right now would not help either way.
 */
export function wikiWriteErrorResponse(error: WikiWriteError): Response {
  if (error.kind === 'busy') {
    return jsonError(503, 'The wiki repo was busy — try again');
  }
  return jsonError(502, "Couldn't reach the wiki repo");
}
