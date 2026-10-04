import 'server-only';

import { type OAuthParameter, signRequest } from './oauth';

/**
 * Instapaper's one-time xAuth exchange: the owner's username and password, signed with the
 * consumer pair, traded for the access token/secret every later request is signed with. Run once,
 * by hand, through `npm run instapaper:token -w frontend` — never by the app, which stores no
 * password (Instapaper's API terms allow one only for this exchange).
 */

export interface XAuthInput {
  /** Origin of the Full API, e.g. `https://www.instapaper.com`. */
  apiUrl: string;
  consumerKey: string;
  consumerSecret: string;
  username: string;
  password: string;
}

export interface AccessToken {
  token: string;
  tokenSecret: string;
}

/** Trade the owner's credentials for an access token pair. Throws with Instapaper's answer on a refusal. */
export async function exchangeForAccessToken(input: XAuthInput): Promise<AccessToken> {
  const url = `${input.apiUrl.replace(/\/+$/, '')}/api/1/oauth/access_token`;
  const parameters: OAuthParameter[] = [
    ['x_auth_username', input.username],
    ['x_auth_password', input.password],
    ['x_auth_mode', 'client_auth'],
  ];
  const authorization = signRequest('POST', url, parameters, {
    consumerKey: input.consumerKey,
    consumerSecret: input.consumerSecret,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
    body: new URLSearchParams(parameters.map(([name, value]) => [name, value])).toString(),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Instapaper refused the exchange: HTTP ${String(response.status)} ${body}`);
  }

  // The answer is a form-encoded line: `oauth_token=…&oauth_token_secret=…`.
  const answer = new URLSearchParams(body);
  const token = answer.get('oauth_token');
  const tokenSecret = answer.get('oauth_token_secret');
  if (token === null || tokenSecret === null) {
    throw new Error('Instapaper answered without an access token');
  }
  return { token, tokenSecret };
}
