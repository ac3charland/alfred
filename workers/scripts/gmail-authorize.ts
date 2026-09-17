/**
 * Mint one Gmail refresh token by hand. Not a test, not a gate — the other half of `gmail-probe`.
 *
 * `gmail-probe` answers "do these credentials still open the mailbox?". This answers the question
 * that comes first and only ever gets asked in an outage: "where does a refresh token come from?"
 * The health surface's instruction when a token dies is `re-authorize`, and until this script
 * existed that instruction named no procedure — which is how a seven-day expiry became a
 * ten-minute scramble through a console UI that had been rebuilt since anyone last looked at it.
 *
 * Two flags are the whole reason this is a script rather than a paragraph in a runbook.
 * `access_type=offline` asks for a refresh token at all. `prompt=consent` asks for one EVEN THOUGH
 * this account has consented to this client before — without it Google returns an access token,
 * omits `refresh_token` entirely, and the failure looks like success until the secret is already
 * deployed. Re-authorization is by definition always the second consent, so the flag that only
 * matters the second time is the flag that always matters here.
 *
 * The redirect is a loopback server on an ephemeral port, which is the flow a Desktop OAuth client
 * is for: it registers no redirect URIs, so there is nothing to add in the console and nothing to
 * remember to remove afterwards. The port is whatever the OS hands out, and the consent URL is
 * built after the listener is up so the two cannot disagree.
 *
 * It writes nothing and stores nothing. The refresh token is printed once, to be pasted into
 * `workers/.dev.vars` and then `wrangler secret put`. The access token is never printed: it is of
 * no use to a human and a token in a terminal is a token in a scrollback buffer.
 *
 * Self-contained for the same reason `gmail-probe` is — Node runs this by stripping its types,
 * which cannot resolve the extensionless imports the Worker source uses.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/** The only scope the poller uses. It reads profile, message lists and messages; it writes nothing. */
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/** The loopback host Google accepts for an installed app. `localhost` also works; this is explicit. */
const HOST = '127.0.0.1';

/** What the browser tab says once the code is in hand, so the tab can be closed with confidence. */
const DONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>alfred</title>' +
  '<body style="font:16px system-ui;padding:3rem"><p>Authorized. Close this tab and return to the terminal.</p>';

/** `.dev.vars` is dotenv: `KEY=value` a line, `#` a comment. Same reader as the probe. */
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

/** Stand up the loopback listener and resolve with the code Google redirects back with. */
async function awaitCode(): Promise<{ redirectUri: string; code: Promise<string> }> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, HOST, resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('loopback server did not report a port');
  }
  const redirectUri = `http://${HOST}:${String(address.port)}`;

  const code = new Promise<string>((resolve, reject) => {
    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', redirectUri);
      const returned = url.searchParams.get('code');
      const denied = url.searchParams.get('error');

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(DONE_PAGE);
      server.close();

      if (denied !== null) reject(new Error(`consent was refused: ${denied}`));
      else if (returned === null) reject(new Error('redirect carried no code'));
      else resolve(returned);
    });
  });

  return { redirectUri, code };
}

/** Trade the one-time code for tokens. Only the refresh token is returned; the access token is dropped. */
async function exchange(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`code exchange failed: ${String(response.status)} ${await response.text()}`);
  }

  // `text()` then `JSON.parse`, matching the probe: under the scripts tsconfig `Response.json()`
  // resolves to an error type (two `Response` declarations in scope) and the lint refuses it.
  const payload = JSON.parse(await response.text()) as { refresh_token?: string };
  const refresh = payload.refresh_token ?? '';
  if (refresh === '') {
    throw new Error(
      'the response carried no refresh_token — Google withholds one when the account has already ' +
        'consented and prompt=consent was not sent. This script always sends it, so this most ' +
        'likely means the consent screen was dismissed rather than completed.',
    );
  }
  return refresh;
}

const vars = readDevVars(path.join(import.meta.dirname, '..', '.dev.vars'));
const clientId = vars['GMAIL_OAUTH_CLIENT_ID'] ?? '';
const clientSecret = vars['GMAIL_OAUTH_CLIENT_SECRET'] ?? '';

if (clientId === '' || clientSecret === '') {
  console.log(
    'workers/.dev.vars has no GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET — nothing to authorize.',
  );
  console.log('Add the Desktop OAuth client there, then run this again.');
} else {
  const { redirectUri, code } = await awaitCode();

  const consent = new URL(AUTH_ENDPOINT);
  for (const [key, value] of [
    ['client_id', clientId],
    ['redirect_uri', redirectUri],
    ['response_type', 'code'],
    ['scope', SCOPE],
    // The two that matter. See the module doc.
    ['access_type', 'offline'],
    ['prompt', 'consent'],
  ]) {
    consent.searchParams.set(key ?? '', value ?? '');
  }

  console.log('\nOpen this in the browser, signed in as the account you are authorizing:\n');
  console.log(consent.toString());
  console.log(
    '\ngmail.readonly is a restricted scope, so an unverified app warning is expected:' +
      '\n  "Google hasn\'t verified this app" -> Advanced -> Go to Alfred Comms (unsafe)\n',
  );
  console.log('Waiting for the redirect...');

  const refresh = await exchange(clientId, clientSecret, await code, redirectUri);
  console.log('\nRefresh token (paste into workers/.dev.vars, then wrangler secret put):\n');
  console.log(refresh);
}
