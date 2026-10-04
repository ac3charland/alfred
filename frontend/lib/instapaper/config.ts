import 'server-only';

/**
 * Instapaper's Full API credentials, read from environment.
 *
 * The Full API is signed with OAuth 1.0a, which needs four values: the application's consumer
 * key and secret, and an access token and secret bound to the owner's account. There is no
 * password anywhere — Instapaper's terms allow one only for the one-time token exchange, which
 * happens outside the app (`npm run instapaper:token`).
 *
 * Each var is read by its literal name (never a computed key), mirroring `lib/github/config.ts`.
 * Nothing here is `NEXT_PUBLIC_` — all four are secrets, and `server-only` makes an import from
 * a client component a build error rather than a leak.
 *
 * `undefined` means "this deployment doesn't send to Instapaper". The Work instance and local
 * dev are both in that case: the send route answers 501 and the row's verb renders disabled with
 * a sentence saying so, which is why a partial configuration counts as none — three of four
 * credentials would otherwise fail at Instapaper with a signature error the owner can do nothing
 * about.
 */

/** Where the Full API lives. Overridable so the E2E mock can stand in for it. */
export const DEFAULT_INSTAPAPER_API_URL = 'https://www.instapaper.com';

export interface InstapaperConfig {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  /** The API origin, trailing slash trimmed, so a path can be appended to it directly. */
  apiUrl: string;
}

/** Trim and collapse a blank env value to `undefined`, so `??` defaults treat "" as unset. */
function envValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === '') return undefined;
  return trimmed;
}

/**
 * The four credentials plus the API origin, or `null` when any credential is missing. Never
 * throws: an unconfigured deployment is an ordinary state the route and the row both render.
 */
export function getInstapaperConfig(): InstapaperConfig | null {
  // One guard per credential rather than one combined condition: each narrows its own value, so
  // the object below needs no assertion about what has already been checked.
  const consumerKey = envValue(process.env.INSTAPAPER_CONSUMER_KEY);
  if (consumerKey === undefined) return null;
  const consumerSecret = envValue(process.env.INSTAPAPER_CONSUMER_SECRET);
  if (consumerSecret === undefined) return null;
  const accessToken = envValue(process.env.INSTAPAPER_ACCESS_TOKEN);
  if (accessToken === undefined) return null;
  const accessTokenSecret = envValue(process.env.INSTAPAPER_ACCESS_TOKEN_SECRET);
  if (accessTokenSecret === undefined) return null;

  const apiUrl = envValue(process.env.INSTAPAPER_API_URL) ?? DEFAULT_INSTAPAPER_API_URL;
  return {
    consumerKey,
    consumerSecret,
    accessToken,
    accessTokenSecret,
    apiUrl: apiUrl.replace(/\/+$/, ''),
  };
}
