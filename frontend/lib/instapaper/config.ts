import 'server-only';

/**
 * Instapaper Full API configuration, read from environment by literal name (never a computed
 * key), mirroring `lib/github/config.ts`.
 *
 * Four OAuth 1.0a values sign every request: the consumer key/secret of an application registered
 * in Instapaper's Owner Only mode, and the access token/secret its one-time xAuth exchange issued
 * for the owner's account (`npm run instapaper:token -w frontend`). No password is ever stored —
 * Instapaper's terms allow one only for that exchange. A deployment without all four (the Work
 * instance, local dev) has no Instapaper: the Reader's send verb renders disabled.
 *
 * Nothing here is `NEXT_PUBLIC_`, and `server-only` keeps a client component from importing it.
 */

/** Where the Full API lives unless `INSTAPAPER_API_URL` names a stand-in (the E2E mock). */
export const INSTAPAPER_DEFAULT_API_URL = 'https://www.instapaper.com';

export interface InstapaperConfig {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  /** Origin the `/api/1/…` paths are appended to, without a trailing slash. */
  apiUrl: string;
}

/** Trim and collapse a blank env value to `undefined`, so "" counts as unset. */
function envValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** The four credentials and the API origin, or `null` unless all four credentials are set. */
export function getInstapaperConfig(): InstapaperConfig | null {
  const consumerKey = envValue(process.env.INSTAPAPER_CONSUMER_KEY);
  const consumerSecret = envValue(process.env.INSTAPAPER_CONSUMER_SECRET);
  const accessToken = envValue(process.env.INSTAPAPER_ACCESS_TOKEN);
  const accessTokenSecret = envValue(process.env.INSTAPAPER_ACCESS_TOKEN_SECRET);
  // One by one rather than one condition, so each value is narrowed to a string below.
  if (consumerKey === undefined) return null;
  if (consumerSecret === undefined) return null;
  if (accessToken === undefined) return null;
  if (accessTokenSecret === undefined) return null;

  const apiUrl = (envValue(process.env.INSTAPAPER_API_URL) ?? INSTAPAPER_DEFAULT_API_URL).replace(
    /\/+$/,
    '',
  );
  return { consumerKey, consumerSecret, accessToken, accessTokenSecret, apiUrl };
}
