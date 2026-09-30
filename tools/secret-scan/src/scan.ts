import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { createEngine } from '@secretlint/node';

import { type KnownSecret, knownSecretsReport } from './known-secrets.ts';

/**
 * The repo's single secretlint config (`/.secretlintrc.json`). `tools/showboat` loads the same
 * file, so the commit gate and the record-time guard can never disagree about what a secret is.
 */
export const CONFIG_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../.secretlintrc.json',
);

/**
 * Leading bytes of the binary formats the repo tracks (PNG, GIF, …) and other common ones. Only a
 * real signature marks a file as binary: git's "a NUL byte means binary" heuristic would let one
 * stray NUL hide a whole text file — and its secrets — from the scan.
 */
const BINARY_SIGNATURES: readonly (readonly number[])[] = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0x47, 0x49, 0x46, 0x38], // GIF ("GIF8")
  [0xff, 0xd8, 0xff], // JPEG
  [0x77, 0x4f, 0x46, 0x46], // WOFF
  [0x77, 0x4f, 0x46, 0x32], // WOFF2
  [0x25, 0x50, 0x44, 0x46], // PDF ("%PDF")
  [0x50, 0x4b, 0x03, 0x04], // ZIP
  [0x50, 0x4b, 0x05, 0x06], // ZIP (empty archive)
  [0x1f, 0x8b], // gzip
];

function startsWith(content: Buffer, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => content[offset + index] === byte);
}

/** Whether `content` opens with the signature of a real binary format (see above). */
export function hasBinaryMagic(content: Buffer): boolean {
  if (BINARY_SIGNATURES.some((signature) => startsWith(content, signature))) return true;
  // WebP is a RIFF container ("RIFF" <size> "WEBP"); other RIFF files (WAV, AVI) are not skipped.
  return (
    startsWith(content, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(content, [0x57, 0x45, 0x42, 0x50], 8)
  );
}

/**
 * The text to scan for a file's bytes, or `undefined` for a known binary format. UTF-16 with a
 * BOM is decoded as UTF-16; anything else is read as UTF-8 with each NUL byte turned into a
 * newline, so a stray NUL neither hides the file nor glues its neighbours together.
 */
export function decodeText(content: Buffer): string | undefined {
  if (hasBinaryMagic(content)) return undefined;
  if (startsWith(content, [0xff, 0xfe])) return new TextDecoder('utf-16le').decode(content);
  if (startsWith(content, [0xfe, 0xff])) return new TextDecoder('utf-16be').decode(content);
  return content.toString('utf8').replaceAll('\0', '\n');
}

/** Text to scan, labelled with where it came from (a path, `path (staged)`, `<sha>:path`). */
export interface Entry {
  label: string;
  content: string;
}

const MAX_BUFFER = 256 * 1024 * 1024;
/** Blob bytes read from `git cat-file --batch` per call, so a big range never blows the buffer. */
const BLOB_BATCH_BYTES = 64 * 1024 * 1024;

/**
 * Run git and return stdout. A failure throws an error whose message names the subcommand and git's
 * first stderr line — never stdout, which can hold file content (Node's own errors attach it).
 */
function git(repoRoot: string, args: readonly string[], input?: string): Buffer {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    maxBuffer: MAX_BUFFER,
    ...(input === undefined ? {} : { input }),
  });
  const command = `git ${args.find((arg) => !arg.startsWith('-')) ?? ''}`.trim();
  if (result.error) throw new Error(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const reason = result.stderr.toString('utf8').trim().split('\n', 1)[0] ?? '';
    throw new Error(`${command} failed (exit ${String(result.status)}): ${reason}`);
  }
  return result.stdout;
}

function nulSeparated(output: Buffer): string[] {
  return output
    .toString('utf8')
    .split('\0')
    .filter((item) => item !== '');
}

/** One `git diff --raw` / `git log --raw` record: the new side of a changed path. */
interface RawRecord {
  commit: string | undefined;
  mode: string;
  blob: string;
  path: string;
}

const COMMIT_ID = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const NO_BLOB = /^0+$/;

/**
 * Parse the `-z` output of `git diff --raw` or `git log --raw --no-abbrev --format=%H`: NUL-separated
 * tokens, a `:<mode> <mode> <blob> <blob> <status>` record then its path, with a bare commit id in
 * front of each commit's records (git log only). Deleted paths and unmerged (all-zero) blobs are
 * dropped, and so are gitlinks (mode 160000 — a submodule commit, not a blob).
 */
function rawRecords(output: Buffer): RawRecord[] {
  const tokens = output.toString('utf8').split('\0');
  const records: RawRecord[] = [];
  let commit: string | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = (tokens[index] ?? '').replace(/^\n/, '');
    if (token.startsWith(':')) {
      const [, mode = '', , blob = ''] = token.split(' ');
      const path = tokens[(index += 1)] ?? '';
      if (mode !== '160000' && mode !== '000000' && !NO_BLOB.test(blob)) {
        records.push({ commit, mode, blob, path });
      }
    } else if (COMMIT_ID.test(token)) {
      commit = token;
    }
  }
  return records;
}

/**
 * The bytes of each blob, in one `git cat-file --batch` round trip per size-bounded chunk (a blob
 * larger than the bound gets a chunk of its own). Unlike `show <rev>:<path>` this addresses blobs
 * by id, so no path — `0:foo`, one with a newline — can resolve to the wrong object.
 */
function readBlobs(repoRoot: string, blobs: readonly string[]): Map<string, Buffer> {
  const sizes = new Map<string, number>();
  const checked = git(repoRoot, ['cat-file', '--batch-check'], `${blobs.join('\n')}\n`)
    .toString('utf8')
    .split('\n');
  for (const line of checked) {
    const [id = '', type = '', size = ''] = line.split(' ');
    if (id === '') continue;
    if (type !== 'blob') throw new Error(`git cat-file: ${id} is not a readable blob`);
    sizes.set(id, Number(size));
  }
  const chunks: string[][] = [];
  let bytes = 0;
  for (const blob of blobs) {
    const size = sizes.get(blob) ?? 0;
    if (chunks.length === 0 || bytes + size > BLOB_BATCH_BYTES) {
      chunks.push([]);
      bytes = 0;
    }
    chunks.at(-1)?.push(blob);
    bytes += size;
  }
  const contents = new Map<string, Buffer>();
  for (const chunk of chunks) {
    const out = git(repoRoot, ['cat-file', '--batch'], `${chunk.join('\n')}\n`);
    let offset = 0;
    for (const blob of chunk) {
      const headerEnd = out.indexOf(0x0a, offset);
      const size = Number(out.subarray(offset, headerEnd).toString('utf8').split(' ', 3)[2]);
      contents.set(blob, out.subarray(headerEnd + 1, headerEnd + 1 + size));
      offset = headerEnd + 1 + size + 1;
    }
  }
  return contents;
}

/** Wrap content as an entry, or `undefined` for a binary. */
function textEntry(label: string, content: Buffer): Entry | undefined {
  const text = decodeText(content);
  return text === undefined ? undefined : { label, content: text };
}

function isEntry(entry: Entry | undefined): entry is Entry {
  return entry !== undefined;
}

/** Bytes a working-tree path stands for: a file's content, a symlink's link text; else nothing. */
function readWorkingFile(repoRoot: string, file: string): Buffer | undefined {
  const full = path.join(repoRoot, file);
  const stat = lstatSync(full, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) return readlinkSync(full, 'buffer');
  return stat?.isFile() ? readFileSync(full) : undefined;
}

/**
 * Every file git could commit under `repoRoot`, repo-relative: tracked (committed or staged) plus
 * untracked-but-not-ignored. The untracked half matters because the gate can run before `git add`
 * (the batch-commits script does). Gitignored files — a local `.env.local` full of real
 * credentials — are never listed, so a secret that is safely *not* committable can't fail the
 * gate. A path that's gone from disk or is a directory (a gitlink) is skipped; a symlink is kept,
 * and is scanned as its link text (see {@link readWorkingFile}), never its target.
 */
export function committableFiles(repoRoot: string): string[] {
  return nulSeparated(
    git(repoRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
  ).filter((file) => {
    const stat = lstatSync(path.join(repoRoot, file), { throwIfNoEntry: false });
    return stat !== undefined && (stat.isFile() || stat.isSymbolicLink());
  });
}

/**
 * The staged (index) content of every path added, modified or type-changed — what the next commit
 * will actually record, which the working copy can differ from (a secret staged, then scrubbed or
 * deleted on disk without re-staging). Read by blob id, straight from `git diff --cached`.
 */
export function stagedEntries(repoRoot: string): Entry[] {
  const records = rawRecords(
    git(repoRoot, [
      'diff',
      '--cached',
      '--raw',
      '-z',
      '--no-abbrev',
      '--no-renames',
      '--diff-filter=d',
    ]),
  );
  if (records.length === 0) return [];
  const contents = readBlobs(repoRoot, [...new Set(records.map((record) => record.blob))]);
  return records
    .map((record) =>
      textEntry(`${record.path} (staged)`, contents.get(record.blob) ?? Buffer.alloc(0)),
    )
    .filter(isEntry);
}

/**
 * The content every commit selected by `revs` added or modified, one entry per distinct blob. A
 * plain `A..B` string is a range; a list may carry exclusions (`['<sha>', '--not', …]`). A secret
 * committed and then removed later in the range is still caught — it's public the moment that
 * intermediate commit is pushed. Merge commits count: `-m` diffs each against every parent, so a
 * conflict resolution or an "evil merge" is scanned like any commit.
 */
export function rangeEntries(repoRoot: string, revs: string | readonly string[]): Entry[] {
  if (typeof revs === 'string' && revs.startsWith('-')) {
    throw new Error(`the range "${revs}" must not start with "-"`);
  }
  const output = git(repoRoot, [
    'log',
    '-m',
    '--raw',
    '-z',
    '--no-abbrev',
    '--no-renames',
    '--diff-filter=d',
    '--format=%H',
    ...(typeof revs === 'string' ? [revs] : revs),
    '--',
  ]);
  const seen = new Set<string>();
  const records = rawRecords(output).filter((record) => {
    if (seen.has(record.blob)) return false;
    seen.add(record.blob);
    return true;
  });
  if (records.length === 0) return [];
  const contents = readBlobs(repoRoot, [...seen]);
  return records
    .map((record) =>
      textEntry(
        `${(record.commit ?? '').slice(0, 12)}:${record.path}`,
        contents.get(record.blob) ?? Buffer.alloc(0),
      ),
    )
    .filter(isEntry);
}

/** The branch trunk that `--branch` measures from. */
const TRUNK = 'origin/main';

/**
 * `origin/main..HEAD` — the commits this branch would publish. Unlike `<merge-base>..HEAD` it needs
 * no common ancestor, so an orphan branch or a shallow clone is still fully scanned. With no
 * `origin/main` there is nothing to measure from, and that fails closed rather than scanning nothing.
 */
export function branchRange(repoRoot: string): string {
  const probe = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${TRUNK}^{commit}`], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  if (probe.status !== 0) {
    throw new Error(
      `no ${TRUNK} to measure the branch from, so it cannot be scanned (fetch it: git fetch origin main)`,
    );
  }
  return `${TRUNK}..HEAD`;
}

/**
 * Revisions for a push, from git's pre-push stdin (`<local ref> <local sha> <remote ref> <remote
 * sha>` per ref): the commits being pushed that `remote` does not have yet — every pushed local sha
 * minus what its remote-tracking refs (and the tip each ref is replacing, when known locally)
 * already hold. A deletion pushes nothing. Empty when there is nothing to scan.
 */
export function pushRevs(repoRoot: string, remote: string, stdin: string): string[] {
  const pushed = new Set<string>();
  const replaced = new Set<string>();
  for (const raw of stdin.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const fields = line.split(/\s+/);
    const [, localSha = '', , remoteSha = ''] = fields;
    if (fields.length !== 4 || !COMMIT_ID.test(localSha) || !COMMIT_ID.test(remoteSha)) {
      throw new Error(
        'malformed line on stdin: expected the pre-push hook\'s "<local ref> <local sha> <remote ref> <remote sha>"',
      );
    }
    if (NO_BLOB.test(localSha)) continue;
    pushed.add(localSha);
    if (!NO_BLOB.test(remoteSha)) {
      const known = spawnSync('git', ['cat-file', '-e', `${remoteSha}^{commit}`], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      if (known.status === 0) replaced.add(remoteSha);
    }
  }
  if (pushed.size === 0) return [];
  return [...pushed, '--not', `--remotes=${remote}`, ...replaced];
}

export interface ScanResult {
  ok: boolean;
  /** secretlint's report, secrets masked — safe to print in a public CI log. Empty when ok. */
  output: string;
  /** How many (text) entries were scanned; known binary formats are skipped. */
  scanned: number;
}

/**
 * secretlint honours `secretlint-disable` comments anywhere in the content (preset-recommend
 * bundles the filter, and a preset sub-rule can't be `disabled`), so any file could silence the
 * gate. Defuse every directive before scanning; same length, so reported positions don't move.
 */
export function defuseDirectives(content: string): string {
  return content.replaceAll(/secretlint-(?=disable|enable)/g, 'secretlint_');
}

type Engine = Awaited<ReturnType<typeof createEngine>>;

/**
 * Build the secretlint engine with `DEBUG` unset. secretlint logs through the `debug` module, which
 * reads `DEBUG` once as it loads and — with `DEBUG=@secretlint/*` — prints every scanned file's raw
 * content, secrets included, into CI logs. Loading it (and the rules `createEngine` imports) with
 * the variable removed leaves that logging off for good; the variable is put back straight after.
 */
async function loadEngine(configFilePath: string): Promise<Engine> {
  const debug = process.env['DEBUG'];
  delete process.env['DEBUG'];
  try {
    const { createEngine: create } = await import('@secretlint/node');
    return await create({
      cwd: path.dirname(configFilePath),
      configFilePath,
      formatter: 'stylish',
      color: false,
      // Documented as the default, but secretlint 13 prints the raw secret unless it's set.
      maskSecrets: true,
    });
  } finally {
    if (debug !== undefined) process.env['DEBUG'] = debug;
  }
}

/** Scan labelled text against the repo's secretlint config. */
export async function scanEntries(
  entries: readonly Entry[],
  configFilePath: string = CONFIG_FILE,
): Promise<ScanResult> {
  if (entries.length === 0) return { ok: true, output: '', scanned: 0 };
  const engine = await loadEngine(configFilePath);
  const reports: string[] = [];
  for (const { label, content } of entries) {
    const result = await engine.executeOnContent({
      content: defuseDirectives(content),
      filePath: label,
    });
    if (!result.ok) reports.push(result.output);
  }
  return { ok: reports.length === 0, output: reports.join('\n'), scanned: entries.length };
}

/** The text of `files` (relative to `repoRoot`) as they are on disk; a symlink reads as its link text. */
export function fileEntries(repoRoot: string, files: readonly string[]): Entry[] {
  return files
    .map((file) => {
      const content = readWorkingFile(repoRoot, file);
      return content === undefined ? undefined : textEntry(file, content);
    })
    .filter(isEntry);
}

/** Scan `files` (relative to `repoRoot`) as they are on disk; a symlink is scanned as its link text. */
export async function scanFiles(
  repoRoot: string,
  files: readonly string[],
  configFilePath: string = CONFIG_FILE,
): Promise<ScanResult> {
  return scanEntries(fileEntries(repoRoot, files), configFilePath);
}

/**
 * Refuse any entry that contains one of the live secret `secrets` this process holds (see
 * `known-secrets.ts`) — the check patterns can't do. The report names each entry and where the value
 * came from, never the value. `scanned` is 0: these entries are counted by the pattern scan.
 */
export function scanKnownSecrets(
  entries: readonly Entry[],
  secrets: readonly KnownSecret[],
): ScanResult {
  const reports = entries
    .map(({ label, content }) => knownSecretsReport(content, label, secrets))
    .filter((report): report is string => report !== undefined);
  return { ok: reports.length === 0, output: reports.join('\n'), scanned: 0 };
}
