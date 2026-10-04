/**
 * Mint the Instapaper access token the Reader's send verb signs with. Run once, by hand.
 *
 * Instapaper's Full API is OAuth 1.0a, but it has no browser redirect flow: an application
 * registered in Owner Only mode exchanges the owner's username and password for a long-lived
 * token in a single signed request (`x_auth_mode=client_auth`, Instapaper's xAuth). That exchange
 * is the only thing in the whole feature that ever sees a password, which is why it lives here
 * rather than in the app — Instapaper's API terms allow a password for exactly this and nothing
 * else.
 *
 * It writes nothing and stores nothing. The password is read from a prompt (never an argument, so
 * it cannot land in a shell history), is held only for the one request, and is never printed. The
 * token pair is printed once, to be pasted into the deployment's env.
 *
 * It signs through `lib/instapaper/oauth.ts` — the same signer the send route uses — so a change
 * to the signing rules cannot leave the token exchange behind. That shared import is why this is
 * run through `scripts/ts-resolve.mjs`: the app's modules are written for a bundler, and the hook
 * is what lets plain Node resolve them.
 */
import process from 'node:process';
import { createInterface } from 'node:readline/promises';

import { DEFAULT_INSTAPAPER_API_URL } from '@/lib/instapaper/config';
import { oauthNonce, oauthTimestamp, signRequest } from '@/lib/instapaper/oauth';

/** Where the exchange lives, relative to the API origin. */
const ACCESS_TOKEN_PATH = '/api/1/oauth/access_token';

/** Long enough for a human to answer a prompt; short enough to fail rather than hang. */
const TIMEOUT_MS = 30_000;

/** One readline for the whole run; `terminal` defaults off a non-TTY stdin, which is correct. */
const rl = createInterface({ input: process.stdin, output: process.stdout });

/**
 * The input, line by line. Read through readline's own async iterator rather than
 * `rl.question`, which drops the lines already buffered behind the one it answered — so a
 * `printf | npm run …` run (the only way this script is exercised without a human) would hang on
 * the second prompt.
 */
const lines: AsyncIterator<string> = rl[Symbol.asyncIterator]();

/** The echo seam's replacement while a password is being typed: paint nothing. */
function swallowEcho(): void {
  // Deliberately empty — silencing the echo IS the behaviour. (A `() => undefined` here is
  // rewritten to an empty arrow by the lint autofix, which the next run then reports.)
}

/**
 * Ask for one value. `hidden` silences the terminal's echo so the password is not left on
 * screen: `_writeToOutput` is readline's own echo seam, and replacing it keeps the keystrokes
 * flowing while nothing is painted back. With no TTY there is no echo to silence, so the flag is
 * simply inert.
 */
async function ask(prompt: string, hidden = false): Promise<string> {
  process.stdout.write(prompt);
  const internals = rl as unknown as { _writeToOutput?: (text: string) => void };
  const original = internals._writeToOutput?.bind(rl);
  if (hidden && original !== undefined) internals._writeToOutput = swallowEcho;
  try {
    const line = await lines.next();
    return line.done === true ? '' : line.value.trim();
  } finally {
    if (hidden) process.stdout.write('\n');
    if (hidden && original !== undefined) internals._writeToOutput = original;
  }
}

async function run(): Promise<void> {
  process.stdout.write(
    'Instapaper access-token exchange.\n' +
      'Register an application at https://www.instapaper.com/developers/applications/create\n' +
      'first — Owner Only mode is enough and needs no review.\n\n',
  );

  const consumerKey = await ask('Consumer key: ');
  const consumerSecret = await ask('Consumer secret: ');
  const username = await ask('Instapaper username (email): ');
  const password = await ask('Instapaper password (not echoed, never stored): ', true);

  if (consumerKey === '' || consumerSecret === '' || username === '') {
    process.stdout.write(
      '\nNothing to do: the consumer key, its secret and the username are all required.\n',
    );
    process.exitCode = 1;
    return;
  }

  const apiUrl = (process.env.INSTAPAPER_API_URL ?? DEFAULT_INSTAPAPER_API_URL).replace(/\/+$/, '');
  const url = `${apiUrl}${ACCESS_TOKEN_PATH}`;
  const parameters: [string, string][] = [
    ['x_auth_username', username],
    ['x_auth_password', password],
    ['x_auth_mode', 'client_auth'],
  ];

  // No token yet, so the token and its secret are empty — the signing key is still the consumer
  // secret followed by the ampersand the spec requires either way.
  const authorization = signRequest(
    'POST',
    url,
    parameters,
    { consumerKey, consumerSecret, token: '', tokenSecret: '' },
    { nonce: oauthNonce(), timestamp: oauthTimestamp() },
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body: new URLSearchParams(parameters).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // A hand-run script should say which host it could not reach rather than printing a stack.
    process.stdout.write(`\nCould not reach ${url}: ${String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const text = await response.text();
  if (!response.ok) {
    // The body is Instapaper's, and it never contains the password — but it can name the account,
    // so it is printed as the diagnosis rather than summarised away.
    process.stdout.write(
      `\nInstapaper refused the exchange (HTTP ${String(response.status)}):\n${text}\n`,
    );
    process.exitCode = 1;
    return;
  }

  // The answer is form-encoded, not JSON — the one place in this feature where it is.
  const answer = new URLSearchParams(text);
  const token = answer.get('oauth_token');
  const tokenSecret = answer.get('oauth_token_secret');
  if (token === null || tokenSecret === null) {
    process.stdout.write(`\nInstapaper answered without a token pair:\n${text}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    '\nDone. Set these four on the deployment (Vercel → Settings → Environment Variables,\n' +
      'Production) and redeploy. None of them is NEXT_PUBLIC_.\n\n' +
      `INSTAPAPER_CONSUMER_KEY=${consumerKey}\n` +
      `INSTAPAPER_CONSUMER_SECRET=${consumerSecret}\n` +
      `INSTAPAPER_ACCESS_TOKEN=${token}\n` +
      `INSTAPAPER_ACCESS_TOKEN_SECRET=${tokenSecret}\n`,
  );
}

try {
  await run();
} finally {
  rl.close();
}
