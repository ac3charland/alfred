import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { resolveDatabaseUrl } from './migrate.ts';

/**
 * Build the `psql` argv and extra env for `url`. The password is lifted out of the URL into
 * `PGPASSWORD`, so it appears in neither the command line (`ps`) nor anything that echoes the
 * command — the whole point of this wrapper is that a live query never carries the credential.
 */
export function psqlInvocation(
  url: string,
  args: readonly string[],
): { args: string[]; env: Record<string, string> } {
  const parsed = new URL(url);
  // libpq also accepts the password as a query parameter; lift that one off argv too.
  const password =
    decodeURIComponent(parsed.password) || (parsed.searchParams.get('password') ?? '');
  parsed.password = '';
  parsed.searchParams.delete('password');
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

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`psql: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
