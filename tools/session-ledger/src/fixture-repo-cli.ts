import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { buildFixtureRepo } from './fixture-repo.ts';

/**
 * Build the scripted fixture repo (see fixture-repo.ts) at the directory given, for the demo doc:
 *   npm run fixture-repo -w tools/session-ledger -- <dir>
 * Prints each role's commit sha. The directory must be new or empty.
 */
const target = process.argv[2];
if (target === undefined) {
  process.stderr.write('usage: fixture-repo <dir>\n');
  process.exitCode = 2;
} else {
  const dir = path.resolve(process.env['INIT_CWD'] ?? process.cwd(), target);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    process.stderr.write(`fixture-repo: ${dir} is not empty\n`);
    process.exitCode = 2;
  } else {
    const { dir: _dir, ...shas } = buildFixtureRepo(dir);
    for (const [role, sha] of Object.entries(shas))
      process.stdout.write(`${role.padEnd(7)} ${sha}\n`);
  }
}
