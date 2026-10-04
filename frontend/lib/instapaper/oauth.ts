import { createHmac, randomBytes } from 'node:crypto';

import 'server-only';

/**
 * OAuth 1.0a request signing (RFC 5849, HMAC-SHA1) — the one scheme Instapaper's Full API
 * accepts. Hand-rolled because the surface is tiny (one signature method, form-encoded bodies,
 * no redirects) and a dependency would be a larger thing to trust than these ~80 lines, which a
 * published test vector pins down.
 *
 * `server-only`: signing needs the consumer and token secrets, which must never reach a
 * browser bundle. The import sits beside `node:crypto` only — no `@/` aliases — because the
 * one-off token script (`scripts/instapaper-token.mjs`) imports this file under plain Node,
 * where the alias would not resolve.
 */

/**
 * The secrets a request is signed with. `token` and `tokenSecret` are absent for exactly one
 * call: the one-off xAuth exchange that mints the access token, which is signed with the
 * consumer pair alone.
 */
export interface OAuthCredentials {
  consumerKey: string;
  consumerSecret: string;
  token?: string | undefined;
  tokenSecret?: string | undefined;
}

/** The two per-request values OAuth uses to make a signature single-use. */
export interface OAuthStamp {
  nonce: string;
  timestamp: string;
}

/** What `encodeURIComponent` leaves bare but RFC 5849 does not. */
const EXTRA_ESCAPES: Record<string, string> = {
  '!': '%21',
  '*': '%2A',
  "'": '%27',
  '(': '%28',
  ')': '%29',
};

/**
 * Percent-encode per RFC 5849 section 3.6: everything but `A-Z a-z 0-9 - . _ ~` becomes `%XX`
 * with uppercase hex. `encodeURIComponent` leaves `! * ' ( )` alone, which the RFC does not, so
 * those are escaped by hand — one unescaped `'` in a title would make a signature Instapaper
 * can't reproduce, and the request would fail as "unauthorized" for no visible reason.
 */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replaceAll(
    /[!*'()]/g,
    (character) => EXTRA_ESCAPES[character] ?? character,
  );
}

/**
 * A sorted copy, by insertion. Not `lib/sort`'s `stableSorted`: this file is imported by a
 * plain-Node script, where the `@/` alias doesn't resolve, and the repo bans the mutating
 * `Array#sort` while its ES2022 target has no `toSorted`. A request has a dozen parameters at
 * most, so the quadratic walk costs nothing.
 */
function sortedBy<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  const sorted: T[] = [];
  for (const item of items) {
    const insertAt = sorted.findIndex((existing) => compare(existing, item) > 0);
    if (insertAt === -1) sorted.push(item);
    else sorted.splice(insertAt, 0, item);
  }
  return sorted;
}

/** Byte-order comparison. Everything compared here is already percent-encoded ASCII. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * The request's parameters as the RFC's section 3.4.1.3.2 normalized string: the URL's own
 * query parameters plus `params` (the form body and the `oauth_*` fields, minus the signature),
 * each name and value percent-encoded, sorted by name and then by value, and joined
 * `name=value` with `&`.
 *
 * The query is read with form decoding, so a `+` in it means a space — the same reading the
 * server applies before it recomputes the signature.
 */
export function normalizedParameters(url: string, params: Record<string, string>): string {
  const pairs: [string, string][] = [
    ...new URL(url).searchParams.entries(),
    ...Object.entries(params),
  ];

  const encoded = pairs.map(([name, value]): [string, string] => [
    percentEncode(name),
    percentEncode(value),
  ]);

  return sortedBy(encoded, ([nameA, valueA], [nameB, valueB]) => {
    const byName = compareStrings(nameA, nameB);
    return byName === 0 ? compareStrings(valueA, valueB) : byName;
  })
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

/**
 * The string that actually gets signed (RFC 5849 section 3.4.1): the uppercased method, the
 * base string URI (scheme and host lowercased, a default port dropped, no query), and the
 * normalized parameters, each percent-encoded and joined with `&`.
 *
 * `params` is everything the URL's query doesn't already carry: the form body plus the
 * `oauth_*` fields other than `oauth_signature`.
 */
export function signatureBaseString(
  method: string,
  url: string,
  params: Record<string, string>,
): string {
  // `URL` lowercases scheme and host and elides the scheme's default port; an empty path
  // comes back as "/", which is what the RFC asks for.
  const { protocol, host, pathname } = new URL(url);
  const baseUri = `${protocol}//${host}${pathname}`;

  return [
    method.toUpperCase(),
    percentEncode(baseUri),
    percentEncode(normalizedParameters(url, params)),
  ].join('&');
}

/**
 * The `Authorization` header value that signs one request.
 *
 * `params` is the form body, decoded: the signature covers what the server will see AFTER
 * it parses the body, so these are the raw values, not their `application/x-www-form-urlencoded`
 * form. (The body itself may be encoded however is convenient — `URLSearchParams` writes a
 * space as `+`, where the signature wants `%20`.)
 *
 * The header carries the `oauth_*` fields only. The body travels as the body, never in here.
 */
export function signRequest(
  method: string,
  url: string,
  params: Record<string, string>,
  creds: OAuthCredentials,
  stamp: OAuthStamp,
): string {
  const oauthFields: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: stamp.nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: stamp.timestamp,
    ...(creds.token !== undefined && { oauth_token: creds.token }),
    oauth_version: '1.0',
  };

  const baseString = signatureBaseString(method, url, { ...params, ...oauthFields });
  // The key is both secrets, encoded, joined with `&` even when the token secret is empty —
  // the token-less exchange signs with "consumerSecret&".
  const key = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.tokenSecret ?? '')}`;
  const signature = createHmac('sha1', key).update(baseString).digest('base64');

  const fields = { ...oauthFields, oauth_signature: signature };
  const header = sortedBy(Object.entries(fields), ([nameA], [nameB]) =>
    compareStrings(nameA, nameB),
  )
    .map(([name, value]) => `${name}="${percentEncode(value)}"`)
    .join(', ');
  return `OAuth ${header}`;
}

/** A fresh nonce and timestamp: 128 random bits, and whole seconds since the epoch. */
export function freshStamp(): OAuthStamp {
  return {
    nonce: randomBytes(16).toString('hex'),
    timestamp: Math.floor(Date.now() / 1000).toString(),
  };
}
