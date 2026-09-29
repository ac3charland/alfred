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

/**
 * Every tracked (committed or staged) regular file under `repoRoot`, repo-relative. Untracked and
 * gitignored files — a local `.env.local` full of real credentials — are never listed, so a secret
 * that is safely *not* committed can't fail the gate. A tracked path that's gone from disk or
 * isn't a regular file (a symlink to a directory) is skipped.
 */
export function trackedFiles(repoRoot: string): string[] {
  const listing = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  return listing
    .split('\0')
    .filter((file) => file !== '')
    .filter((file) => statSync(path.join(repoRoot, file), { throwIfNoEntry: false })?.isFile());
}

export interface ScanResult {
  ok: boolean;
  /** secretlint's report, secrets masked — safe to print in a public CI log. Empty when ok. */
  output: string;
  /** How many (text) files were scanned; binaries are skipped. */
  scanned: number;
}

/** Scan `files` (relative to `repoRoot`) against the repo's secretlint config. */
export async function scanFiles(
  repoRoot: string,
  files: readonly string[],
  configFilePath: string = CONFIG_FILE,
): Promise<ScanResult> {
  const textFiles = files
    .map((file) => path.join(repoRoot, file))
    .filter((file) => !isBinary(readFileSync(file)));
  if (textFiles.length === 0) return { ok: true, output: '', scanned: 0 };

  const engine = await createEngine({
    cwd: repoRoot,
    configFilePath,
    formatter: 'stylish',
    color: false,
    // Documented as the default, but secretlint 13 prints the raw secret unless it's set.
    maskSecrets: true,
  });
  const { ok, output } = await engine.executeOnFiles({ filePathList: textFiles });
  return { ok, output: ok ? '' : output, scanned: textFiles.length };
}
