/**
 * Trading a stored refresh token for a short-lived access token, once per account per poll.
 *
 * Only the refresh token is stored — as a Worker secret, set by hand — and it is the credential
 * that matters: it is long-lived, it is per-account, and it is what a human has to replace when
 * Google stops accepting it. So this module has one job and one rule. The job is the exchange. The
 * rule is that no token, of either kind, ever reaches a log, a summary, an error message or the
 * database. The `detail` returned on failure comes from an ERROR response body, which by
 * construction never contains a token, and is truncated so a stray HTML error page cannot fill a
 * log with something nobody will read anyway.
 *
 * The two failure kinds are the point of the return type. `rejected` means the refresh token
 * itself is dead — revoked, expired, or issued by an OAuth client still in "Testing", which hands
 * out tokens that quietly stop working after seven days. No retry fixes any of those; a human must
 * re-authorize, and the account should read as ERRORING rather than quiet until they do.
 * `transport` is Google having a bad minute, and the right response is to try again next tick.
 */

/** `https://oauth2.googleapis.com/token` — the only endpoint this module talks to. */
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** How much of a failing response is kept. Enough to identify it, not enough to fill a log. */
const MAX_DETAIL_CHARS = 300;

/**
 * The OAuth client both Gmail accounts authenticate through. Required here rather than optional:
 * the caller decides what an unset binding means, and by the time a token is being fetched the
 * question has been answered.
 */
export interface GmailOAuthEnv {
  GMAIL_OAUTH_CLIENT_ID: string;
  GMAIL_OAUTH_CLIENT_SECRET: string;
}

/** An access token, or the reason there isn't one and whether trying again could help. */
export type AccessTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'rejected' | 'transport'; detail: string };

/** Whatever `fetch` itself threw, as a line worth recording. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Exchange one account's refresh token for an access token. Never logs either. */
export async function fetchAccessToken(
  env: GmailOAuthEnv,
  refreshToken: string,
): Promise<AccessTokenResult> {
  const body = new URLSearchParams({
    client_id: env.GMAIL_OAUTH_CLIENT_ID,
    client_secret: env.GMAIL_OAUTH_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (error) {
    return { ok: false, reason: 'transport', detail: describe(error) };
  }

  if (!response.ok) {
    const raw = await response.text();
    const detail = raw.slice(0, MAX_DETAIL_CHARS);
    // `invalid_grant` on a 400 or 401 is Google's way of saying the refresh token is finished.
    // Anything else — including a 5xx dressed up as a 400 — is treated as worth retrying, because
    // parking a live account on a misread error code is the more expensive mistake of the two.
    const dead =
      (response.status === 400 || response.status === 401) && detail.includes('invalid_grant');
    return { ok: false, reason: dead ? 'rejected' : 'transport', detail };
  }

  const payload = await response.json<{ access_token?: string | undefined }>();
  const token = payload.access_token ?? '';
  if (token === '') {
    return { ok: false, reason: 'transport', detail: 'token response carried no access_token' };
  }
  return { ok: true, token };
}
