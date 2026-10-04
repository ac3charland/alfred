import 'server-only';

/**
 * Instapaper credentials, read from environment. The Reader's "Send to Instapaper" verb talks
 * to Instapaper's Full API as the one account the owner registered an application under, so a
 * deployment either carries all four OAuth credentials or has no way to send at all.
 *
 * Each var is read by its literal name (never a computed key), mirroring `lib/github/config.ts`
 * — Next only knows a variable exists because the source spells it out.
 *
 * `server-only`: the consumer secret and the access-token secret sign every request and are the
 * whole of the owner's access to their reading list, so importing this from a Client Component
 * is a build error rather than a leaked credential. Nothing here is `NEXT_PUBLIC_`.
 *
 * Unset (any one of the four) is a normal state, not an error: the route answers 501 and the
 * verb renders disabled with a sentence saying why. Never throws.
 */

/** Where Instapaper's Full API lives. The E2E mock overrides it with `INSTAPAPER_API_URL`. */
export const INSTAPAPER_DEFAULT_API_URL = 'https://www.instapaper.com';

export interface InstapaperConfig {
  /** The application's OAuth consumer key, from instapaper.com/developers. */
  consumerKey: string;
  /** The application's OAuth consumer secret. */
  consumerSecret: string;
  /** The owner's access token, minted once by `npm run instapaper:token -w frontend`. */
  accessToken: string;
  /** The secret that goes with the access token. */
  accessTokenSecret: string;
  /** Instapaper's origin with no trailing slash, so `${apiUrl}/api/1/…` joins cleanly. */
  apiUrl: string;
}

/** Trim and collapse a blank env value to `undefined`, so `??` defaults treat "" as unset. */
function envValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === '') {
    return undefined;
  }
  return trimmed;
}

/** Drop any trailing slashes: the path is appended with a leading one. */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end -= 1;
  return url.slice(0, end);
}

/**
 * The credentials plus the API origin, or `null` when the deployment hasn't configured all
 * four credentials. A half-configured deployment is treated exactly like an unconfigured one:
 * signing with a missing secret would only produce a request Instapaper rejects, and a clear
 * "isn't set up" beats an opaque credentials failure.
 */
export function getInstapaperConfig(): InstapaperConfig | null {
  const consumerKey = envValue(process.env.INSTAPAPER_CONSUMER_KEY);
  const consumerSecret = envValue(process.env.INSTAPAPER_CONSUMER_SECRET);
  const accessToken = envValue(process.env.INSTAPAPER_ACCESS_TOKEN);
  const accessTokenSecret = envValue(process.env.INSTAPAPER_ACCESS_TOKEN_SECRET);
  // `envValue` yields a non-empty string or `undefined`, so truthiness is exactly "was set".
  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) return null;

  const apiUrl = withoutTrailingSlashes(
    envValue(process.env.INSTAPAPER_API_URL) ?? INSTAPAPER_DEFAULT_API_URL,
  );
  return { consumerKey, consumerSecret, accessToken, accessTokenSecret, apiUrl };
}
