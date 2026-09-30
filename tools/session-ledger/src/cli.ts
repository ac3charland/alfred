import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { GitHistory, gitIn } from './git.ts';
import { fetchPulls } from './prs.ts';
import type { PullRequest } from './prs.ts';
import { pushRows } from './push.ts';
import { parseRecordLine, readSessionDir } from './records.ts';
import { BuilderLoader } from './replay.ts';
import { formatReport } from './report.ts';
import { buildRows } from './row.ts';
import type { LedgerInputs, LedgerRow } from './types.ts';
import { sampleIds, sampleable, verifyRecords } from './verify.ts';

const HELP = `session-ledger — backfill the code_sessions ledger (one row per coding session).

Usage:
  build  --sessions <dir> --out <file> [--repo ac3charland/alfred] [--base-url <url>]
         [--pulls <file>] [--inputs <file>] [--git-dir <dir>] [--main-ref origin/main]
                 Join the session records in <dir> (NDJSON) with the repo's PRs, the ledger
                 inputs and git history; write one row per line to <file>. Refuses an <file>
                 inside a git work tree — ledger data is never committed.
                 --pulls reads the PR list from a file of REST pull objects instead of GitHub;
                 --inputs reads GET /api/code/ledger-inputs' payload from a file.
  sample --sessions <dir> [--pct 5] [--min 5]
                 Print max(min, pct%) random session ids to re-fetch for verification.
  verify --sessions <dir> --against <file>
                 Compare the re-fetched records in <file> with the copies; exit 1 on any
                 mismatch in the fields the ledger uses.
  push   <rows> [--report]
                 Upsert <rows> through POST /api/code/sessions in chunks of 100.
  report <rows>  Print the coverage, lane and warning report.

Environment:
  ALFRED_BASE_URL  the app's URL (build's inputs, push). Not a secret.
  LEDGER_API_KEY   sent as a Bearer token only when set; otherwise the proxy adds it.
  GITHUB_TOKEN     sent to GitHub when set.

Paths are relative to where npm was run. Run through the package script:
  npm run ledger -w tools/session-ledger -- <command> …
`;

/** A usage problem the caller should fix; exit code 2. */
class UsageError extends Error {}

/** npm runs a workspace script in the package dir; resolve paths from where it was invoked. */
const CALLER_DIR = process.env['INIT_CWD'] ?? process.cwd();

function resolvePath(file: string): string {
  return path.resolve(CALLER_DIR, file);
}

interface Parsed {
  positional: string[];
  options: Map<string, string>;
  flags: Set<string>;
}

const BOOLEAN_FLAGS = new Set(['--report']);

function parseArgs(argv: readonly string[]): Parsed {
  const parsed: Parsed = { positional: [], options: new Map(), flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (BOOLEAN_FLAGS.has(arg)) {
      parsed.flags.add(arg);
    } else if (arg.startsWith('--')) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--'))
        throw new UsageError(`${arg} needs a value.`);
      parsed.options.set(arg, value);
      i += 1;
    } else {
      parsed.positional.push(arg);
    }
  }
  return parsed;
}

function required(parsed: Parsed, option: string): string {
  const value = parsed.options.get(option);
  if (value === undefined) throw new UsageError(`${option} is required.`);
  return value;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(resolvePath(file), 'utf8'));
}

function readRows(file: string): LedgerRow[] {
  return readFileSync(resolvePath(file), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as LedgerRow);
}

/** The top of the git work tree containing `dir`, or undefined outside any. */
function workTreeOf(dir: string): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/** `dir`, or its closest ancestor that exists — `--out` may name a directory not made yet. */
function nearestExistingDir(dir: string): string {
  let current = dir;
  while (!existsSync(current) && path.dirname(current) !== current) current = path.dirname(current);
  return current;
}

function authHeaders(): Record<string, string> {
  const key = process.env['LEDGER_API_KEY'];
  return key ? { authorization: `Bearer ${key}` } : {};
}

function baseUrlFrom(parsed: Parsed): string {
  const baseUrl = parsed.options.get('--base-url') ?? process.env['ALFRED_BASE_URL'];
  if (!baseUrl) throw new UsageError('set ALFRED_BASE_URL (or pass --base-url).');
  return baseUrl;
}

async function loadInputs(parsed: Parsed, repo: string): Promise<LedgerInputs> {
  const file = parsed.options.get('--inputs');
  if (file !== undefined) return readJson(file) as LedgerInputs;
  const url = new URL('/api/code/ledger-inputs', baseUrlFrom(parsed));
  url.searchParams.set('repo', repo);
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) throw new Error(`${url.pathname} answered ${String(response.status)}`);
  return (await response.json()) as LedgerInputs;
}

async function loadPulls(parsed: Parsed, repo: string): Promise<PullRequest[]> {
  const file = parsed.options.get('--pulls');
  if (file !== undefined) return readJson(file) as PullRequest[];
  return fetchPulls(repo, { token: process.env['GITHUB_TOKEN'] });
}

async function build(parsed: Parsed): Promise<number> {
  const sessionsDir = resolvePath(required(parsed, '--sessions'));
  const out = resolvePath(required(parsed, '--out'));
  const repo = parsed.options.get('--repo') ?? 'ac3charland/alfred';
  const gitDir = resolvePath(parsed.options.get('--git-dir') ?? '.');

  // Ledger data (costs, ticket notes) must never be committed: this repo is public. Refuse any
  // path a git work tree would pick up, gitignored or not.
  const tree = workTreeOf(nearestExistingDir(path.dirname(out)));
  if (tree !== undefined) {
    throw new UsageError(
      `--out ${out} is inside the git work tree ${tree}; write it to the scratchpad.`,
    );
  }

  const git = gitIn(gitDir);
  const history = new GitHistory(git, parsed.options.get('--main-ref') ?? 'origin/main');
  if (history.isShallow()) {
    process.stderr.write('shallow clone: fetching the full history of main…\n');
    git(['fetch', '--quiet', '--unshallow', 'origin', 'main']);
  }

  const sessions = readSessionDir(sessionsDir);
  for (const line of sessions.invalid) {
    process.stderr.write(
      `invalid record: ${line.file}:${String(line.line)} (${line.id ?? 'no id'}) — ${line.reason}\n`,
    );
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'session-ledger-'));
  try {
    const rows = await buildRows({
      repo,
      inputs: await loadInputs(parsed, repo),
      pulls: await loadPulls(parsed, repo),
      sessions,
      history,
      loader: new BuilderLoader(history, tmp),
    });
    writeFileSync(out, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    process.stderr.write(`built ${String(rows.length)} rows → ${out}\n`);
    return 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function sample(parsed: Parsed): number {
  const { records } = readSessionDir(resolvePath(required(parsed, '--sessions')));
  const pct = Number(parsed.options.get('--pct') ?? '5');
  const min = Number(parsed.options.get('--min') ?? '5');
  if (!(pct > 0) || !(min >= 0)) throw new UsageError('--pct and --min must be positive numbers.');
  const ids = sampleIds(sampleable(records), { pct, min });
  process.stdout.write(ids.map((id) => `${id}\n`).join(''));
  return 0;
}

function verify(parsed: Parsed): number {
  const copies = readSessionDir(resolvePath(required(parsed, '--sessions'))).records;
  const refetched = readFileSync(resolvePath(required(parsed, '--against')), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => parseRecordLine(line))
    .flatMap((line) => (line.kind === 'record' ? [line.record] : []));
  if (refetched.length === 0) throw new UsageError('--against holds no session records.');

  const mismatches = verifyRecords(copies, refetched);
  for (const mismatch of mismatches) {
    process.stdout.write(`mismatch: ${mismatch.id} ${mismatch.field}\n`);
  }
  if (mismatches.length > 0) {
    process.stdout.write(
      `${String(mismatches.length)} mismatch(es): re-fetch the offending batches.\n`,
    );
    return 1;
  }
  process.stdout.write(
    `verified ${String(refetched.length)} session(s): every ledger field matches.\n`,
  );
  return 0;
}

async function push(parsed: Parsed): Promise<number> {
  const file = parsed.positional[1];
  if (file === undefined) throw new UsageError('push needs a rows file.');
  const rows = readRows(file);
  const result = await pushRows(rows, {
    baseUrl: baseUrlFrom(parsed),
    key: process.env['LEDGER_API_KEY'],
  });
  if (parsed.flags.has('--report')) process.stdout.write(formatReport(rows, result));
  else {
    process.stdout.write(
      `pushed ${String(result.pushed)} rows (${String(result.upserted)} upserted, ${String(result.kept_recorded)} kept recorded prompts)\n`,
    );
  }
  return 0;
}

function report(parsed: Parsed): number {
  const file = parsed.positional[1];
  if (file === undefined) throw new UsageError('report needs a rows file.');
  process.stdout.write(formatReport(readRows(file)));
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const command = parsed.positional[0];
  switch (command) {
    case 'build': {
      return build(parsed);
    }
    case 'sample': {
      return sample(parsed);
    }
    case 'verify': {
      return verify(parsed);
    }
    case 'push': {
      return push(parsed);
    }
    case 'report': {
      return report(parsed);
    }
    case undefined:
    case 'help': {
      process.stdout.write(HELP);
      return command === undefined ? 2 : 0;
    }
    default: {
      throw new UsageError(`unknown command "${command}". Run "session-ledger help".`);
    }
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`session-ledger: ${message}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
