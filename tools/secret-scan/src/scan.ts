import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEngine } from '@secretlint/node';

/**
 * The repo's single secretlint config (`/.secretlintrc.json`). `tools/showboat` loads the same
 * file, so the commit gate and the record-time guard can never disagree about what a secret is.
 */
export const CONFIG_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../.secretlintrc.json',
);

/** git's own heuristic: a NUL byte in the first 8000 bytes means binary. */
const BINARY_SNIFF_BYTES = 8000;

export function isBinary(content: Buffer): boolean {
  return content.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/** Text to scan, labelled with where it came from (a path, `path (staged)`, `<sha>:path`). */
export interface Entry {
  label: string;
  content: string;
}

function git(repoRoot: string, args: readonly string[]): Buffer {
  return execFileSync('git', args, { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 });
}

function nulSeparated(output: Buffer): string[] {
  return output
    .toString('utf8')
    .split('\0')
    .filter((item) => item !== '');
}

/** Wrap content as an entry, or `undefined` for a binary. */
function textEntry(label: string, content: Buffer): Entry | undefined {
  return isBinary(content) ? undefined : { label, content: content.toString('utf8') };
}

function isEntry(entry: Entry | undefined): entry is Entry {
  return entry !== undefined;
}

/**
 * Every file git could commit under `repoRoot`, repo-relative: tracked (committed or staged) plus
 * untracked-but-not-ignored. The untracked half matters because the gate can run before `git add`
 * (the batch-commits script does). Gitignored files — a local `.env.local` full of real
 * credentials — are never listed, so a secret that is safely *not* committable can't fail the
 * gate. A path that's gone from disk or isn't a regular file (a symlink to a directory) is skipped.
 */
export function committableFiles(repoRoot: string): string[] {
  return nulSeparated(
    git(repoRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
  ).filter((file) => statSync(path.join(repoRoot, file), { throwIfNoEntry: false })?.isFile());
}

/**
 * The staged (index) content of every path added or modified — what the next commit will actually
 * record, which the working copy can differ from (a secret staged, then scrubbed or deleted on
 * disk without re-staging).
 */
export function stagedEntries(repoRoot: string): Entry[] {
  const paths = nulSeparated(
    git(repoRoot, ['diff', '--cached', '--name-only', '-z', '--no-renames', '--diff-filter=AM']),
  );
  return paths
    .map((file) => textEntry(`${file} (staged)`, git(repoRoot, ['show', `:${file}`])))
    .filter(isEntry);
}

/**
 * The content every commit in `range` (e.g. `A..B`) added or modified, one entry per distinct
 * blob. A secret committed and then removed later in the range is still caught — it's public
 * the moment that intermediate commit is pushed.
 */
export function rangeEntries(repoRoot: string, range: string): Entry[] {
  const commits = git(repoRoot, ['rev-list', range])
    .toString('utf8')
    .split('\n')
    .filter((sha) => sha !== '');
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const commit of commits) {
    // Raw records, NUL-separated: ":<mode> <mode> <old-blob> <new-blob> <status>", then the path.
    const fields = nulSeparated(
      git(repoRoot, [
        'diff-tree',
        '-r',
        '-z',
        '--root',
        '--no-commit-id',
        '--no-renames',
        '--diff-filter=AM',
        commit,
      ]),
    );
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const blob = (fields[index] ?? '').split(' ', 4)[3] ?? '';
      const file = fields[index + 1] ?? '';
      if (blob === '' || seen.has(blob)) continue;
      seen.add(blob);
      const entry = textEntry(
        `${commit.slice(0, 12)}:${file}`,
        git(repoRoot, ['cat-file', 'blob', blob]),
      );
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

/**
 * `<merge-base with origin/main>..HEAD` — the commits this branch would publish — or `undefined`
 * when there's no `origin/main` to measure from.
 */
export function branchRange(repoRoot: string): string | undefined {
  try {
    const base = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return `${base}..HEAD`;
  } catch {
    return undefined;
  }
}

export interface ScanResult {
  ok: boolean;
  /** secretlint's report, secrets masked — safe to print in a public CI log. Empty when ok. */
  output: string;
  /** How many (text) entries were scanned; binaries are skipped. */
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

/** Scan labelled text against the repo's secretlint config. */
export async function scanEntries(
  entries: readonly Entry[],
  configFilePath: string = CONFIG_FILE,
): Promise<ScanResult> {
  if (entries.length === 0) return { ok: true, output: '', scanned: 0 };
  const engine = await createEngine({
    cwd: path.dirname(configFilePath),
    configFilePath,
    formatter: 'stylish',
    color: false,
    // Documented as the default, but secretlint 13 prints the raw secret unless it's set.
    maskSecrets: true,
  });
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

/** Scan `files` (relative to `repoRoot`) as they are on disk. */
export async function scanFiles(
  repoRoot: string,
  files: readonly string[],
  configFilePath: string = CONFIG_FILE,
): Promise<ScanResult> {
  const entries = files
    .map((file) => textEntry(file, readFileSync(path.join(repoRoot, file))))
    .filter(isEntry);
  return scanEntries(entries, configFilePath);
}
