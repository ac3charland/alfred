import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';

import pg from 'pg';

import {
  APPLIED_LOG_PATH,
  ENV_LOCAL_PATH,
  parseEnvValue,
  recordApplied,
  resolveMigration,
} from './migrate.ts';

const { Client } = pg;

/**
 * Resolve the live connection string: prefer an exported `DATABASE_URL`, else read it out of the
 * gitignored `frontend/.env.local`. Throws a directive error when neither is available.
 */
function databaseUrl(): string {
  const fromEnv = process.env['DATABASE_URL'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  if (existsSync(ENV_LOCAL_PATH)) {
    const fromFile = parseEnvValue(readFileSync(ENV_LOCAL_PATH, 'utf8'), 'DATABASE_URL');
    if (fromFile !== undefined && fromFile !== '') return fromFile;
  }
  throw new Error(`DATABASE_URL is not set and none found in ${ENV_LOCAL_PATH}`);
}

/** Ask the user to confirm applying to a named host; defaults to no on a bare Enter. */
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Apply ONE migration file to the live database — the deterministic core of `npm run migrate <N>`.
 * Resolves the selector, prints the target host, confirms (unless `--yes`/`-y`), then sends the
 * file as one simple-query batch (multi-statement, dollar-quoted bodies OK), exactly as production.
 */
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const skipConfirm = args.includes('--yes') || args.includes('-y');
  const selector = args.find((arg) => !arg.startsWith('-'));
  if (selector === undefined) {
    process.stderr.write('usage: npm run migrate <NNNN|name.sql> [--yes]\n');
    return 1;
  }

  const file = resolveMigration(selector);
  const url = databaseUrl();
  const host = new URL(url).host;
  process.stdout.write(`→ target: ${host}\n`);

  if (!skipConfirm && !(await confirm(`→ apply ${path.basename(file)}? [y/N] `))) {
    process.stdout.write('aborted.\n');
    return 1;
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(readFileSync(file, 'utf8'));
    process.stdout.write(`✓ applied ${path.basename(file)}\n`);
    // Append to the committed ledger so the branch records what actually reached this host, then
    // nudge the operator to commit it — the paper trail only helps if it lands in git.
    recordApplied(new Date(), host, file);
    process.stdout.write(
      `✎ logged to ${path.relative(process.cwd(), APPLIED_LOG_PATH)} — commit it to record the apply.\n`,
    );
    return 0;
  } finally {
    await client.end();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`migrate: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
