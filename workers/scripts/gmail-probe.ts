/**
 * A one-off, read-only probe against the two Gmail accounts. Not a test, not a gate.
 *
 * It exists to answer one question before anything is merged: do the credentials in
 * `workers/.dev.vars` actually open the two mailboxes the poller expects? That question cannot be
 * asked by the suite — no test in this repo makes a live call — and discovering the answer in
 * production means discovering it as a red dot on the health strip.
 *
 * It writes NOTHING. No database, no labels, no state pushed anywhere. It exchanges each refresh
 * token for a short-lived access token, reads the profile, counts what a seven-day search returns,
 * and prints the headers of the three newest so the filter's inputs can be eyeballed. Tokens are
 * never printed.
 *
 * Deliberately self-contained rather than importing the poller's modules: Node runs this file by
 * stripping its types, which cannot resolve the extensionless imports the Worker source uses. The
 * duplication is a few lines of URL building, and the alternative is a build step for a script
 * whose whole point is to be run once by hand.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** The same seven-day window the poller's first run uses. */
const WINDOW_QUERY = 'newer_than:7d';

/** How many of the newest messages to show headers for. Enough to recognise the mailbox. */
const NEWEST = 3;

/** The headers worth seeing: who it is from, what it says, and what the filter would read. */
const SHOWN_HEADERS = ['From', 'Subject', 'List-Unsubscribe', 'List-ID'];

/** The two accounts, matching the poller's own table. */
const ACCOUNTS = [
  { key: 'gmail-personal', label: 'personal', binding: 'GMAIL_PERSONAL_REFRESH_TOKEN' },
  { key: 'gmail-realplay', label: 'RealPlay', binding: 'GMAIL_REALPLAY_REFRESH_TOKEN' },
];

/** `.dev.vars` is dotenv: `KEY=value` a line, `#` a comment. */
function readDevVars(file: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return {};
  }

  const vars: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const split = trimmed.indexOf('=');
    if (split === -1) continue;
    vars[trimmed.slice(0, split).trim()] = trimmed
      .slice(split + 1)
      .trim()
      .replaceAll(/^["']|["']$/g, '');
  }
  return vars;
}

/** Trade a refresh token for an access token. The token itself never leaves this function's caller. */
async function accessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`token exchange failed: ${String(response.status)} ${await response.text()}`);
  }
  const payload = (await response.json()) as { access_token?: string };
  const token = payload.access_token ?? '';
  if (token === '') throw new Error('token response carried no access_token');
  return token;
}

/** One authenticated GET against the Gmail API. */
async function api<T>(token: string, path: string, params: [string, string][]): Promise<T> {
  const url = new URL(`${GMAIL_API_BASE}/${path}`);
  for (const [key, value] of params) url.searchParams.append(key, value);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${String(response.status)} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** Probe one account and print what it found. */
async function probe(clientId: string, clientSecret: string, refreshToken: string): Promise<void> {
  const token = await accessToken(clientId, clientSecret, refreshToken);

  const profile = await api<{ emailAddress: string; historyId: string }>(token, 'profile', []);
  console.log(`  profile       ${profile.emailAddress} (historyId ${profile.historyId})`);

  const listed = await api<{ messages?: { id: string }[] }>(token, 'messages', [
    ['q', WINDOW_QUERY],
    ['maxResults', '500'],
  ]);
  const ids = (listed.messages ?? []).map((message) => message.id);
  console.log(`  ${WINDOW_QUERY} ${String(ids.length)} message ids on the first page`);

  console.log(`  newest ${String(NEWEST)}:`);
  for (const id of ids.slice(0, NEWEST)) {
    const message = await api<{
      internalDate?: string;
      labelIds?: string[];
      payload?: { headers?: { name: string; value: string }[] };
    }>(token, `messages/${encodeURIComponent(id)}`, [
      ['format', 'metadata'],
      ...SHOWN_HEADERS.map((header): [string, string] => ['metadataHeaders', header]),
    ]);

    const at = new Date(Number(message.internalDate ?? '0')).toISOString();
    console.log(`    ${at}  labels: ${(message.labelIds ?? []).join(',')}`);
    for (const header of message.payload?.headers ?? []) {
      console.log(`      ${header.name}: ${header.value}`);
    }
  }
}

const vars = readDevVars(path.join(import.meta.dirname, '..', '.dev.vars'));
const clientId = vars['GMAIL_OAUTH_CLIENT_ID'] ?? '';
const clientSecret = vars['GMAIL_OAUTH_CLIENT_SECRET'] ?? '';

if (clientId === '' || clientSecret === '') {
  console.log(
    'workers/.dev.vars has no GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET — nothing to probe.',
  );
  console.log('Add the OAuth client and at least one refresh token there, then run this again.');
} else {
  for (const account of ACCOUNTS) {
    const refreshToken = vars[account.binding] ?? '';
    console.log(`${account.key} (${account.label})`);
    if (refreshToken === '') {
      console.log(`  ${account.binding} is not in .dev.vars — skipped.`);
      continue;
    }
    try {
      await probe(clientId, clientSecret, refreshToken);
    } catch (error) {
      process.exitCode = 1;
      console.log(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
