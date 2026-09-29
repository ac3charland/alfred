import { createHash, timingSafeEqual } from 'node:crypto';

import 'server-only';

import { getResearchConfig } from './config';

/**
 * Whether a request carries the research delivery key — the one credential the delivery route
 * takes. It mirrors `validateApiKey` (`lib/api/auth.ts`): the key in `x-api-key` or as
 * `Authorization: Bearer <key>`, with `x-api-key` deciding when both are sent. Two differences,
 * both deliberate:
 *
 *   - It compares against `RESEARCH_DELIVERY_KEY` alone. The ingest key also creates items and
 *     weekly plans; the research session, which reads arbitrary web pages, must hold a key that
 *     can do nothing but deliver a report. An unconfigured deployment (any of the three research
 *     vars unset) accepts nothing.
 *   - The comparison is constant-time. Both sides are hashed first, so the buffers are always the
 *     same length and a wrong guess's length or shared prefix says nothing.
 */
export function hasDeliveryKey(request: Request): boolean {
  const key = getResearchConfig()?.deliveryKey;
  if (key === undefined) return false;

  const presented = presentedKey(request);
  return presented !== undefined && matches(presented, key);
}

/** The credential the request carries: `x-api-key` if present, else a bearer token. */
function presentedKey(request: Request): string | undefined {
  const xApiKey = request.headers.get('x-api-key');
  if (xApiKey !== null) return xApiKey;

  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') === true
    ? authorization.slice('Bearer '.length)
    : undefined;
}

/** A fixed-length fingerprint, so two strings of any length can be compared as equal-size buffers. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Constant-time equality of two strings of any length. */
function matches(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}
