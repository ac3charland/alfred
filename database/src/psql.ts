import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { resolveDatabaseUrl } from './migrate.ts';

const UNSUPPORTED_URL =
  "DATABASE_URL isn't a single-host postgresql:// URL this wrapper can parse; multi-host lists " +
  '(h1:5432,h2:5433), empty-host unix-socket URIs (postgresql://u:pw@/db?host=/dir) and ' +
  'keyword/value strings are unsupported. Use one host:port so the password can be lifted into ' +
  'PGPASSWORD instead of riding on the command line.';

/** `decodeURIComponent` that leaves a malformed escape as-is rather than throwing. */
function tryDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Split a `password` parameter out of a raw query string. The remaining parameters are re-joined
 * verbatim — re-serializing through `URLSearchParams` would turn `%20` into `+`, which libpq reads
 * literally. The key may itself be percent-encoded (`pass%77ord`).
 */
function liftQueryPassword(query: string): { rest: string; password: string | undefined } {
  const kept: string[] = [];
  let password: string | undefined;
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    const key = tryDecode(eq === -1 ? pair : pair.slice(0, eq));
    if (key === 'password') password = eq === -1 ? '' : tryDecode(pair.slice(eq + 1));
    else if (pair !== '') kept.push(pair);
  }
  return { rest: kept.join('&'), password };
}

/**
 * Build the `psql` argv and extra env for `url`. The password is lifted out of the URL into
 * `PGPASSWORD`, so it appears in neither the command line (`ps`) nor anything that echoes the
 * command — the whole point of this wrapper is that a live query never carries the credential.
 * Throws (without echoing the URL) for URL forms it can't parse, rather than guess.
 */
export function psqlInvocation(
  url: string,
  args: readonly string[],
): { args: string[]; env: Record<string, string> } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(UNSUPPORTED_URL);
  }
  // libpq also accepts the password as a query parameter; lift that one off argv too.
  const fromQuery = liftQueryPassword(parsed.search.slice(1));
  const password = tryDecode(parsed.password) || (fromQuery.password ?? '');
  parsed.password = '';
  // Only touch the query when a password was actually in it, so every other byte survives.
  if (fromQuery.password !== undefined) parsed.search = fromQuery.rest;
  const env: Record<string, string> = password === '' ? {} : { PGPASSWORD: password };
  return { args: ['--dbname', parsed.toString(), ...args], env };
}

/**
 * `npm run psql -w database -- <psql args>`: run `psql` against the live database named by
 * `DATABASE_URL` (exported, else read from the gitignored `frontend/.env.local`). The safe way to
 * gather live-database evidence — a demo `exec` of this command reproduces for anyone holding
 * `.env.local` and records no secret.
 */
function main(): number {
  const { args, env } = psqlInvocation(resolveDatabaseUrl(['DATABASE_URL']), process.argv.slice(2));
  const result = spawnSync('psql', args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.error) {
    throw new Error(`could not run psql (${result.error.message}); install the PostgreSQL client`);
  }
  return result.status ?? 1;
}

/**
 * True when this file is the entry script. Compares real paths as file URLs: `argv[1]` keeps a
 * symlink's path and a raw space where `import.meta.url` has the resolved target and `%20`, so a
 * string compare is false there and the script would exit 0 having done nothing.
 */
function isEntryScript(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isEntryScript()) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`psql: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
