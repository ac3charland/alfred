import { createHmac, randomBytes } from 'node:crypto';

import 'server-only';

import { stableSorted } from '@/lib/sort';

/**
 * An OAuth 1.0a HMAC-SHA1 request signer, per RFC 5849 — the only thing Instapaper's Full API
 * accepts.
 *
 * Why hand-rolled rather than a library: this signs exactly one request shape (a form-encoded
 * POST to one host, with a token already in hand) and the whole of it is the fifty lines below.
 * A dependency would add a supply-chain surface for a well-specified string-building exercise
 * that a published test vector pins exactly.
 *
 * Three details are where implementations go wrong, so each has its own reason spelled out:
 *
 * The PERCENT-ENCODING is RFC 5849 §3.6's, not `encodeURIComponent`'s. They agree except on
 * `!`, `'`, `(`, `)` and `*`, which §3.6 requires escaped and `encodeURIComponent` leaves bare —
 * so a title containing an apostrophe would sign correctly and verify as garbage.
 *
 * The BASE STRING carries the form-body parameters alongside the query and the `oauth_*` ones
 * (§3.4.1.3). Instapaper's request is almost entirely body, so omitting them signs an almost
 * empty request and every call fails.
 *
 * The SIGNING KEY is the two secrets, each percent-encoded, joined by `&` (§3.4.2) — the
 * ampersand is present even when the token secret is empty.
 */

/** Everything the signature needs about who is signing. */
export interface OauthCredentials {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

/**
 * The per-request values OAuth wants unique. Injectable so a test can pin them and assert a
 * signature byte for byte; {@link oauthNonce} and {@link oauthTimestamp} supply them live.
 */
export interface OauthStamp {
  nonce: string;
  timestamp: string;
}

/**
 * Percent-encode per RFC 5849 §3.6: everything except the unreserved set
 * `ALPHA / DIGIT / "-" / "." / "_" / "~"`, as uppercase hex, over the UTF-8 bytes.
 */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replaceAll(
    /[!'()*]/g,
    (character) => `%${character.codePointAt(0)?.toString(16).toUpperCase() ?? ''}`,
  );
}

/**
 * The normalized parameter string (§3.4.1.3.2): each name and value percent-encoded, the pairs
 * sorted by encoded name and then by encoded value, joined with `&`.
 *
 * Sorting on the ENCODED forms rather than the raw ones is what the RFC asks for, and the two
 * orders genuinely differ — `c%40` sorts before `c2` because `%` precedes `2`, while `c@` would
 * sort after it.
 */
function normalizeParameters(parameters: [string, string][]): string {
  const encoded = parameters.map(([name, value]): [string, string] => [
    percentEncode(name),
    percentEncode(value),
  ]);
  // Ascending BYTE order, which for these percent-encoded ASCII strings is what `<` gives.
  // `localeCompare` is the trap: it collates, so it reads `%` and `2` as near-equivalent and
  // puts `c2` before `c%40` — the reverse of what the RFC's own worked example prints.
  return stableSorted(encoded, ([nameA, valueA], [nameB, valueB]) => {
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    if (valueA === valueB) return 0;
    return valueA < valueB ? -1 : 1;
  })
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

/**
 * The signature base string (§3.4.1.1): the uppercased method, the base-string URI and the
 * normalized parameters, each percent-encoded and joined by `&`.
 *
 * `url` is split here rather than by the caller because its query is part of the signed
 * parameters while the base-string URI must carry neither query nor fragment (§3.4.1.2).
 */
export function signatureBaseString(
  method: string,
  url: string,
  parameters: [string, string][],
): string {
  const parsed = new URL(url);
  const queryParameters: [string, string][] = [...parsed.searchParams.entries()];
  const baseUri = `${parsed.origin}${parsed.pathname}`;

  return [
    method.toUpperCase(),
    percentEncode(baseUri),
    percentEncode(normalizeParameters([...parameters, ...queryParameters])),
  ].join('&');
}

/**
 * The `oauth_signature` for a base string (§3.4.2): HMAC-SHA1 under a key of the two secrets,
 * each percent-encoded and joined by `&`, base64-encoded. The `&` is there even when the token
 * secret is empty, which is the state the one-off token exchange signs in.
 */
export function hmacSha1Signature(
  baseString: string,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac('sha1', key).update(baseString, 'utf8').digest('base64');
}

/**
 * Sign a request and return the `Authorization` header value.
 *
 * `parameters` is the request's own parameters — for Instapaper, the form body. The seven
 * `oauth_*` fields are added here, so a caller cannot forget one or spell one differently in the
 * signature than in the header.
 */
export function signRequest(
  method: string,
  url: string,
  parameters: [string, string][],
  credentials: OauthCredentials,
  stamp: OauthStamp,
): string {
  const oauthParameters: [string, string][] = [
    ['oauth_consumer_key', credentials.consumerKey],
    ['oauth_nonce', stamp.nonce],
    ['oauth_signature_method', 'HMAC-SHA1'],
    ['oauth_timestamp', stamp.timestamp],
    ['oauth_token', credentials.token],
    ['oauth_version', '1.0'],
  ];

  const base = signatureBaseString(method, url, [...parameters, ...oauthParameters]);
  const signature = hmacSha1Signature(base, credentials.consumerSecret, credentials.tokenSecret);

  const header = [...oauthParameters, ['oauth_signature', signature] as [string, string]]
    .map(([name, value]) => `${percentEncode(name)}="${percentEncode(value)}"`)
    .join(', ');
  return `OAuth ${header}`;
}

/** A fresh nonce. Hex rather than base64 so it needs no encoding inside the header. */
export function oauthNonce(): string {
  return randomBytes(16).toString('hex');
}

/** Now, in whole seconds since the epoch, which is the only form §3.3 allows. */
export function oauthTimestamp(now: Date = new Date()): string {
  return String(Math.floor(now.getTime() / 1000));
}
