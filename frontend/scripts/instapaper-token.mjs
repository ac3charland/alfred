/**
 * One-off Instapaper token exchange. Trades the owner's Instapaper login for the OAuth access
 * token + secret that `INSTAPAPER_ACCESS_TOKEN` / `INSTAPAPER_ACCESS_TOKEN_SECRET` hold, via
 * Instapaper's xAuth endpoint (`POST /api/1/oauth/access_token`, `x_auth_mode=client_auth`).
 *
 *   node --conditions=react-server scripts/instapaper-token.mjs     # or:
 *   npm run instapaper:token -w frontend
 *
 * Run it once, by hand, after registering an application at
 * https://www.instapaper.com/developers/applications/create (Owner Only mode needs no review).
 * It asks for the application's consumer key and secret plus the Instapaper email and password,
 * and prints the two lines to paste into `frontend/.env.local` and the deployment's environment.
 *
 * The password goes to Instapaper in that one request and nowhere else: it is read without
 * echo, never written to disk, never logged, and not part of what is printed. The signing is
 * `lib/instapaper/oauth.ts` — the same code the app signs its bookmark calls with — so this
 * script also proves the signing against the live service in a way a unit test cannot.
 *
 * `--conditions=react-server` is what lets `server-only` (which the signing module imports to
 * keep it out of the browser bundle) resolve to its empty build under plain Node, and Node's
 * built-in type stripping is what lets this .mjs import a .ts module directly.
 *
 * `INSTAPAPER_API_URL` redirects the call (the same variable the app honours), which is how the
 * exchange can be pointed at a local stand-in instead of the real service.
 */
import process from 'node:process';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

import { freshStamp, signRequest } from '../lib/instapaper/oauth.ts';

const DEFAULT_API_URL = 'https://www.instapaper.com';
const REQUEST_TIMEOUT_MS = 30_000;

const USAGE = `Usage: npm run instapaper:token -w frontend

Exchanges your Instapaper login for the OAuth access token the app signs its requests with.
Prompts for, in order:
  - the application's consumer key
  - the application's consumer secret   (hidden as you type)
  - your Instapaper username (email)
  - your Instapaper password            (hidden as you type; never stored or printed)

Prints INSTAPAPER_ACCESS_TOKEN and INSTAPAPER_ACCESS_TOKEN_SECRET for frontend/.env.local and
the deployment's environment. Set INSTAPAPER_API_URL to call somewhere other than ${DEFAULT_API_URL}.
`;

/** Prompts and notes go to stderr, so stdout stays exactly the two lines worth capturing. */
function say(message) {
  process.stderr.write(message);
}

/**
 * A line reader whose echo can be switched off. Readline echoes typed characters to its
 * `output`; pointing that at a stream that swallows writes while `muted` is set is how a
 * password prompt stays silent without any dependency. The prompt text itself is written
 * straight to stderr, outside readline, so muting never hides it.
 */
function createPrompter() {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const readline = createInterface({
    input: process.stdin,
    output,
    terminal: process.stdin.isTTY === true,
  });
  // The line iterator, unlike `question()`, settles when stdin ends — an empty or closed
  // stdin becomes a clear error instead of a process that silently never finishes.
  const lines = readline[Symbol.asyncIterator]();

  return {
    async ask(prompt, { hidden = false } = {}) {
      say(`${prompt}: `);
      muted = hidden;
      const { value, done } = await lines.next();
      muted = false;
      if (hidden) say('\n');
      if (done) throw new Error('Input ended before every question was answered.');
      const answer = value.trim();
      if (answer === '') throw new Error(`${prompt} is required.`);
      return answer;
    },
    close() {
      readline.close();
    },
  };
}

/** xAuth answers in a query-string-shaped body: `oauth_token=…&oauth_token_secret=…`. */
function parseTokenResponse(body) {
  const fields = new URLSearchParams(body.trim());
  const token = fields.get('oauth_token');
  const tokenSecret = fields.get('oauth_token_secret');
  if (!token || !tokenSecret) {
    throw new Error('Instapaper answered, but not with an access token.');
  }
  return { token, tokenSecret };
}

async function exchange({ consumerKey, consumerSecret, username, password }) {
  let apiUrl = process.env.INSTAPAPER_API_URL?.trim() || DEFAULT_API_URL;
  while (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
  const url = `${apiUrl}/api/1/oauth/access_token`;

  const params = {
    x_auth_username: username,
    x_auth_password: password,
    x_auth_mode: 'client_auth',
  };
  // No token yet — that is what this call mints — so it is signed with the consumer pair alone.
  const authorization = signRequest(
    'POST',
    url,
    params,
    { consumerKey, consumerSecret },
    freshStamp(),
  );

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      Authorization: authorization,
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();

  if (!response.ok) {
    // Instapaper's own words, never ours: the password is not in anything it sends back.
    const detail = body.trim().slice(0, 300);
    throw new Error(
      `Instapaper answered HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`,
    );
  }
  return parseTokenResponse(body);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    say(USAGE);
    return;
  }

  const prompter = createPrompter();
  let credentials;
  try {
    credentials = {
      consumerKey: await prompter.ask('Consumer key'),
      consumerSecret: await prompter.ask('Consumer secret', { hidden: true }),
      username: await prompter.ask('Instapaper username (email)'),
      password: await prompter.ask('Instapaper password', { hidden: true }),
    };
  } finally {
    prompter.close();
  }

  const { token, tokenSecret } = await exchange(credentials);

  say('\nAdd these to frontend/.env.local and the deployment environment, alongside\n');
  say('INSTAPAPER_CONSUMER_KEY and INSTAPAPER_CONSUMER_SECRET. The password was not stored.\n\n');
  process.stdout.write(`INSTAPAPER_ACCESS_TOKEN=${token}\n`);
  process.stdout.write(`INSTAPAPER_ACCESS_TOKEN_SECRET=${tokenSecret}\n`);
}

try {
  await main();
} catch (error) {
  say(`\nerror: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
