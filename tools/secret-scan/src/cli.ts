import { execFileSync } from 'node:child_process';
import process from 'node:process';

import { scanFiles, trackedFiles } from './scan.ts';

const HELP = `secret-scan — fail if any git-tracked file contains a secret.

Usage:
  secret-scan       Scan every tracked (committed or staged) text file in the repo
                    with secretlint, using the repo-root .secretlintrc.json.

Options:
  --help, -h        Show this help.

In this repo, run it through the package script: npm run lint:secrets -w tools/secret-scan
`;

const REMEDY = `
secret-scan: a secret is in a tracked file. This repo is PUBLIC — everything committed or pushed
is published. Remove it from the file (and \`git rm --cached\` it if the whole file is a secret);
if it was ever pushed, treat it as leaked and rotate it. For live-database evidence use
\`npm run psql -w database -- -c "<sql>"\`, which reads the URL from frontend/.env.local.
A placeholder that trips a rule: write it as <password>, **** or "$VAR" — never weaken
/.secretlintrc.json to get green (see the secret-scan skill).
`;

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv.length > 0) {
    process.stderr.write(
      `secret-scan: unexpected argument "${argv.join(' ')}". Run "secret-scan --help".\n`,
    );
    return 2;
  }

  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const result = await scanFiles(repoRoot, trackedFiles(repoRoot));
  if (!result.ok) {
    process.stdout.write(result.output);
    process.stderr.write(REMEDY);
    return 1;
  }
  process.stdout.write(`secret-scan: ${String(result.scanned)} tracked text file(s) clean.\n`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
