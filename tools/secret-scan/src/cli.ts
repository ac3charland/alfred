import { execFileSync } from 'node:child_process';
import process from 'node:process';

import {
  type ScanResult,
  branchRange,
  committableFiles,
  rangeEntries,
  scanEntries,
  scanFiles,
  stagedEntries,
} from './scan.ts';

const HELP = `secret-scan — fail if anything git could commit or publish contains a secret.

Usage:
  secret-scan                 Scan every committable text file (tracked, or untracked and not
                              gitignored) as it is on disk, plus the staged content of every
                              added/modified path. The check:fast gate.
  secret-scan --range <A..B>  Scan the content every commit in A..B added or modified, so a
                              secret added and later removed is still caught.
  secret-scan --branch        --range <merge-base with origin/main>..HEAD: every commit this
                              branch would publish. The check:slow (pre-push) gate.

Options:
  --help, -h        Show this help.

All modes use the repo-root .secretlintrc.json. In this repo, run it through the package scripts:
  npm run lint:secrets -w tools/secret-scan
  npm run lint:secrets:branch -w tools/secret-scan
`;

const REMEDY = `
secret-scan: a secret would be committed or published. This repo is PUBLIC — everything committed
or pushed is published. Remove it from the file (and \`git rm --cached\` it if the whole file is a
secret); if it was ever pushed, treat it as leaked and rotate it. A flagged commit on your own
unmerged branch also needs the branch rewritten (fixup + force-push) so main never carries it.
For live-database evidence use \`npm run psql -w database -- -c "<sql>"\`, which reads the URL
from frontend/.env.local. A placeholder that trips a rule: write it as <password>, **** or
"$VAR" — never weaken /.secretlintrc.json to get green (see the secret-scan skill).
`;

/** A usage problem the caller should fix; reported to stderr with exit code 2. */
class UsageError extends Error {}

async function scanTree(repoRoot: string): Promise<ScanResult[]> {
  return [
    await scanFiles(repoRoot, committableFiles(repoRoot)),
    await scanEntries(stagedEntries(repoRoot)),
  ];
}

async function scan(repoRoot: string, argv: readonly string[]): Promise<ScanResult[] | undefined> {
  const [flag, value, ...extra] = argv;
  if (extra.length > 0) throw new UsageError(`unexpected argument "${extra.join(' ')}"`);
  switch (flag) {
    case undefined: {
      return scanTree(repoRoot);
    }
    case '--range': {
      if (value === undefined) throw new UsageError('--range needs a revision range, e.g. A..B');
      return [await scanEntries(rangeEntries(repoRoot, value))];
    }
    case '--branch': {
      if (value !== undefined) throw new UsageError(`unexpected argument "${value}"`);
      const range = branchRange(repoRoot);
      return range === undefined ? undefined : [await scanEntries(rangeEntries(repoRoot, range))];
    }
    default: {
      throw new UsageError(`unknown option "${flag}"`);
    }
  }
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();

  const results = await scan(repoRoot, argv);
  if (results === undefined) {
    process.stdout.write(
      'secret-scan: no origin/main to measure the branch from; skipped the commit scan.\n',
    );
    return 0;
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    process.stdout.write(`${failed.map((result) => result.output).join('\n')}\n`);
    process.stderr.write(REMEDY);
    return 1;
  }
  const scanned = results.reduce((sum, result) => sum + result.scanned, 0);
  process.stdout.write(`secret-scan: clean (${String(scanned)} text entries scanned).\n`);
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`secret-scan: ${error.message}. Run "secret-scan --help".\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
