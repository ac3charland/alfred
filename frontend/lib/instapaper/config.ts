import 'server-only';

import type { OAuthCredentials } from './oauth';

/**
 * Instapaper configuration, read from environment: the four OAuth 1.0a values a Full API request
 * is signed with, and where the API lives.
 *
 * All four credentials, or the feature is off: `getInstapaperConfig()` is null, the send route
 * answers 501 and the Reader draws its Send verb disabled. That is the Work instance and local dev
 * — a deployment that sends nothing to anyone's Instapaper. Each var is read by its literal name
 * (never a computed key), mirroring `lib/github/config.ts`, and none is `NEXT_PUBLIC_`: the
 * consumer secret and token secret together are the owner's Instapaper account.
 *
 * `INSTAPAPER_API_URL` exists only so the E2E suite can point the route at its mock; unset, it is
 * Instapaper itself.
 */

export const DEFAULT_INSTAPAPER_API_URL = 'https://www.instapaper.com';

export interface InstapaperConfig {
  /** The API's origin, no trailing slash — `/api/1/...` is appended per request. */
  apiUrl: string;
  /** The application's consumer pair and the owner's access-token pair. */
  credentials: Required<OAuthCredentials>;
}

/** Trim and collapse a blank env value to `undefined`, so a var set to "" reads as unset. */
function envValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** The deployment's Instapaper config, or null unless all four credentials are set. Never throws. */
export function getInstapaperConfig(): InstapaperConfig | null {
  const consumerKey = envValue(process.env.INSTAPAPER_CONSUMER_KEY);
  const consumerSecret = envValue(process.env.INSTAPAPER_CONSUMER_SECRET);
  const token = envValue(process.env.INSTAPAPER_ACCESS_TOKEN);
  const tokenSecret = envValue(process.env.INSTAPAPER_ACCESS_TOKEN_SECRET);
  if (consumerKey === undefined || consumerSecret === undefined) return null;
  if (token === undefined || tokenSecret === undefined) return null;

  const apiUrl = (envValue(process.env.INSTAPAPER_API_URL) ?? DEFAULT_INSTAPAPER_API_URL).replace(
    /\/+$/,
    '',
  );
  return { apiUrl, credentials: { consumerKey, consumerSecret, token, tokenSecret } };
}
