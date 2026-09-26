/**
 * Mint the owner's Instapaper access token — once, by hand. Not a test and not part of any build.
 *
 * Instapaper's Full API signs every request with four values: the application's consumer key and
 * secret (from instapaper.com/developers, where an app starts in Owner Only mode — enough for a
 * single-user system, with no review) and the owner's access token and token secret. The token
 * pair comes from xAuth: one signed POST to `/api/1/oauth/access_token` carrying the owner's
 * Instapaper username and password. That exchange is the ONLY place Instapaper's terms allow the
 * password to be handled, and this script handles it only in memory: it is read from the terminal
 * without echoing, sent once, and never written anywhere — not to a file, not to the output.
 *
 *   npm run instapaper:token -w frontend
 *
 * It prints the token pair to paste into Vercel as INSTAPAPER_ACCESS_TOKEN and
 * INSTAPAPER_ACCESS_TOKEN_SECRET, beside the consumer pair. A consumer key and secret already set
 * in the shell's environment (INSTAPAPER_CONSUMER_KEY / _SECRET) are used without asking.
 *
 * Signed by the app's own signer rather than a second copy of it. Node loads that `.ts` module by
 * stripping its types, and `--conditions=react-server` (in the npm script) resolves its
 * `server-only` marker to the empty module a Server Component gets.
 */
import process from 'node:process';
import { createInterface } from 'node:readline/promises';

import { signRequest } from '../lib/instapaper/oauth.ts';

const API_URL = (process.env.INSTAPAPER_API_URL ?? 'https://www.instapaper.com').replace(
  /\/+$/,
  '',
);

/** Enter (either line ending) or Ctrl-C: the keystrokes that end a hidden prompt. */
const ENDS_INPUT = new Set(['\r', '\n', '\u0003']);

/** Ctrl-C at a hidden prompt: raw mode swallows the signal, so it is honoured by hand. */
class Cancelled extends Error {}

/** Every line piped in, for a non-interactive run; read lazily so a TTY run never touches it. */
let pipedLines;

async function nextPipedLine() {
  if (pipedLines === undefined) {
    const lines = [];
    for await (const line of createInterface({ input: process.stdin })) lines.push(line);
    pipedLines = lines;
  }
  return pipedLines.shift() ?? '';
}

/** Ask for a value, echoing what is typed. */
async function ask(question) {
  if (!process.stdin.isTTY) {
    const line = await nextPipedLine();
    return line.trim();
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(question);
    return answer.trim();
  } finally {
    prompt.close();
  }
}

/** Ask for a secret without echoing it: raw mode, one keystroke at a time. */
async function askSecret(question) {
  if (!process.stdin.isTTY) return await nextPipedLine();
  process.stdout.write(question);
  const { stdin } = process;
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  try {
    return await new Promise((resolve, reject) => {
      let value = '';
      const onData = (chunk) => {
        for (const character of chunk) {
          if (ENDS_INPUT.has(character)) {
            stdin.off('data', onData);
            if (character === '\u0003') reject(new Cancelled());
            else resolve(value);
            return;
          }
          value =
            character === '\u007F' || character === '\b' ? value.slice(0, -1) : value + character;
        }
      };
      stdin.on('data', onData);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
    process.stdout.write('\n');
  }
}

/** The exchange itself. Resolves with the process's exit code. */
async function main() {
  const consumerKey = process.env.INSTAPAPER_CONSUMER_KEY?.trim() || (await ask('Consumer key: '));
  const consumerSecret =
    process.env.INSTAPAPER_CONSUMER_SECRET?.trim() || (await askSecret('Consumer secret: '));
  const username = await ask('Instapaper username (email): ');
  const password = await askSecret('Instapaper password (not echoed, never stored): ');

  if (!consumerKey || !consumerSecret || !username) {
    process.stderr.write('A consumer key, a consumer secret and a username are all required.\n');
    return 2;
  }

  const url = `${API_URL}/api/1/oauth/access_token`;
  const params = {
    x_auth_username: username,
    x_auth_password: password,
    x_auth_mode: 'client_auth',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: signRequest('POST', url, params, { consumerKey, consumerSecret }),
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await response.text();

  // A success is a query string, not JSON: `oauth_token=…&oauth_token_secret=…`.
  const answer = new URLSearchParams(body);
  const token = answer.get('oauth_token');
  const tokenSecret = answer.get('oauth_token_secret');

  if (!response.ok || !token || !tokenSecret) {
    // The body is Instapaper's own error (JSON, with an error_code). It never echoes the password.
    process.stderr.write(
      `Instapaper refused the exchange (HTTP ${String(response.status)}): ${body}\n`,
    );
    return 1;
  }

  process.stdout.write(
    [
      '',
      'Set these on the Personal instance’s Vercel project (Production), beside the consumer pair:',
      '',
      `  INSTAPAPER_ACCESS_TOKEN=${token}`,
      `  INSTAPAPER_ACCESS_TOKEN_SECRET=${tokenSecret}`,
      '',
    ].join('\n'),
  );
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (!(error instanceof Cancelled)) throw error;
  process.exitCode = 130;
}
