import { execFileSync } from 'node:child_process';
import process from 'node:process';

import { knownSecrets, repoEnvRoots } from './known-secrets.ts';
import {
  type Entry,
  type ScanResult,
  branchRange,
  committableFiles,
  fileEntries,
  pushRevs,
  rangeEntries,
  scanEntries,
  scanKnownSecrets,
  stagedEntries,
} from './scan.ts';

const HELP = `secret-scan — fail if anything git could commit or publish contains a secret.

Usage:
  secret-scan                 Scan every committable text file (tracked, or untracked and not
                              gitignored) as it is on disk, plus the staged content of every
                              added/modified path. The check:fast gate.
  secret-scan --range <A..B>  Scan the content every commit in A..B added or modified, so a
                              secret added and later removed is still caught.
  secret-scan --branch        --range origin/main..HEAD: every commit this branch would publish.
                              Fails (exit 1) when there is no origin/main. The check:slow gate,
                              and the fallback for a new branch in CI.
  secret-scan --push <remote> Read git's pre-push stdin (one "<local ref> <local sha> <remote ref>
                              <remote sha>" line per ref) and scan the commits being pushed that
                              <remote> does not have yet, whichever branch is checked out. The
                              .husky/pre-push gate.

Options:
  --help, -h        Show this help.

All modes use the repo-root .secretlintrc.json, and also refuse content that contains a live secret
value this process holds (credential-named env vars, and the gitignored dotenv files — frontend/.env*,
workers/.dev.vars*, database/.env*, .env* — of this checkout and the main one, so a linked worktree
sees them too); a finding names where the value came from, never the value. In this repo, run it
through the package scripts:
  npm run lint:secrets -w tools/secret-scan
  npm run lint:secrets:branch -w tools/secret-scan
  npm run lint:secrets:push -w tools/secret-scan -- <remote>   (stdin from git's pre-push hook)
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

/**
 * Scan `entries` for patterns and for the live secret values this process holds: credential-named
 * environment variables and those in the gitignored dotenv files of this checkout and the main
 * worktree (see `known-secrets.ts`). Every mode runs both, so a bare password no rule recognises
 * still stops the commit or push.
 */
async function scanContent(
  repoRoot: string,
  ...groups: (readonly Entry[])[]
): Promise<ScanResult[]> {
  const secrets = knownSecrets({ envRoots: repoEnvRoots(repoRoot) });
  const results: ScanResult[] = [];
  for (const entries of groups) results.push(await scanEntries(entries));
  results.push(scanKnownSecrets(groups.flat(), secrets));
  return results;
}

async function scanTree(repoRoot: string): Promise<ScanResult[]> {
  return scanContent(
    repoRoot,
    fileEntries(repoRoot, committableFiles(repoRoot)),
    stagedEntries(repoRoot),
  );
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new UsageError(
      '--push reads the pre-push hook\'s "<local ref> <local sha> <remote ref> <remote sha>" lines from stdin',
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

async function scan(repoRoot: string, argv: readonly string[]): Promise<ScanResult[]> {
  const [flag, value, ...extra] = argv;
  if (extra.length > 0) throw new UsageError(`unexpected argument "${extra.join(' ')}"`);
  switch (flag) {
    case undefined: {
      return scanTree(repoRoot);
    }
    case '--range': {
      if (value === undefined) throw new UsageError('--range needs a revision range, e.g. A..B');
      return scanContent(repoRoot, rangeEntries(repoRoot, value));
    }
    case '--branch': {
      if (value !== undefined) throw new UsageError(`unexpected argument "${value}"`);
      return scanContent(repoRoot, rangeEntries(repoRoot, branchRange(repoRoot)));
    }
    case '--push': {
      if (value === undefined)
        throw new UsageError('--push needs the remote name git passes the hook');
      const revs = pushRevs(repoRoot, value, await readStdin());
      return scanContent(repoRoot, revs.length === 0 ? [] : rangeEntries(repoRoot, revs));
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
    // Only the message: a Node child-process error also carries the git output (`stdout`,
    // `stderr` buffers), which can hold file content — printing the object would leak it.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`secret-scan: error: ${message}\n`);
    process.exitCode = 1;
  }
}
