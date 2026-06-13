import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type Entry, type ShowboatDocument, parseDocument, serializeDocument } from './document.ts';
import { convertWebmToGif } from './ffmpeg.ts';
import { type RunResult, runCode } from './run.ts';

const IMAGE_MARKDOWN = /^!\[([^\]]*)\]\(([^)]*)\)$/;

function load(file: string): ShowboatDocument {
  return parseDocument(readFileSync(file, 'utf8'));
}

function save(file: string, document: ShowboatDocument): void {
  writeFileSync(file, serializeDocument(document));
}

export interface InitOptions {
  /**
   * The branch this demo belongs to. When given (and non-empty), it's stamped into
   * the doc's YAML front matter so `demo-lint` can read it — decoupling the folder
   * name (which can be a semantic feature name) from the branch name.
   */
  branch?: string | undefined;
  /** Override the timestamp (defaults to now); injected for deterministic tests. */
  now?: Date;
}

/**
 * Create a fresh demo doc with a title and an ISO-8601 timestamp. Creates any
 * missing parent folders so a demo can be initialized straight into its own folder
 * (e.g. `docs/demos/<feature-name>/<name>.md`) without a manual `mkdir`. When a
 * branch is supplied it's recorded in YAML front matter (see {@link InitOptions}).
 */
export function init(file: string, title: string, options: InitOptions = {}): void {
  const { branch, now = new Date() } = options;
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const frontMatter = branch ? `branch: ${branch}` : undefined;
  save(file, { frontMatter, title, timestamp: now.toISOString(), entries: [] });
}

/** Append a commentary paragraph. */
export function note(file: string, text: string): void {
  const document = load(file);
  document.entries.push({ kind: 'note', text: text.replace(/\n+$/, '') });
  save(file, document);
}

/**
 * Run a code block, append it (with captured output) to the doc, and return the
 * captured output plus the child's exit code so the CLI can echo the output and
 * exit with the same status — surfacing failures the same way running the
 * command directly would.
 */
export function exec(file: string, lang: string, code: string, workdir: string): RunResult {
  const document = load(file);
  const result = runCode(lang, code, workdir);
  document.entries.push({
    kind: 'exec',
    lang,
    // Stryker disable next-line Regex,StringLiteral: AT_CEILING — trimTrailingNewlines in makeFence (document.ts) re-strips all trailing newlines on serialization, so /\n+$/ vs /\n$/ and the empty-string replacement are unobservable through any file round-trip.
    code: code.replace(/\n+$/, ''),
    output: result.output,
  });
  save(file, document);
  return result;
}

/**
 * Embed an image. Accepts either a bare path or a full `![alt](path)`. The source
 * file is copied next to the doc under a generated, collision-free name.
 */
export function image(file: string, argument: string): void {
  const document = load(file);
  const markdown = IMAGE_MARKDOWN.exec(argument.trim());
  // Stryker disable next-line StringLiteral: AT_CEILING — when the regex matches, groups 1 and 2 are always captured (they're `[^\]]*` and `[^)]*`); markdown[1]/markdown[2] are never undefined, so the ?? '' fallback is a TS-type-safety guard that is unreachable at runtime.
  const alt = markdown ? (markdown[1] ?? '') : '';
  // Stryker disable next-line StringLiteral: AT_CEILING — same as above; markdown[2] is always defined when the regex matches.
  const source = markdown ? (markdown[2] ?? '') : argument;

  const documentDirectory = path.dirname(path.resolve(file));
  const extension = path.extname(source) || '.png';
  const stem = path.basename(file, path.extname(file));
  const imageCount = document.entries.filter((entry) => entry.kind === 'image').length;
  const generated = `${stem}-image-${String(imageCount + 1)}${extension}`;

  copyFileSync(source, path.join(documentDirectory, generated));
  document.entries.push({ kind: 'image', alt, path: generated });
  save(file, document);
}

/**
 * Embed a screen recording. Playwright writes an animation as a `.webm`, which
 * GitHub's file and markdown viewers won't render — so we convert it to an
 * animated GIF (which *does* inline as a markdown image), save that next to the
 * doc under a generated, collision-free name, embed it, and delete the now-redundant
 * `.webm`. The conversion runs entirely in WASM (no system `ffmpeg`).
 *
 * The `convert` step is injectable so this orchestration is unit-testable without
 * spinning up ffmpeg.wasm. The `.webm` is deleted only after the GIF is safely
 * written and the doc saved, so a failed conversion leaves the recording intact.
 */
export async function video(
  file: string,
  webmPath: string,
  alt = '',
  convert: (webmPath: string) => Promise<Uint8Array> = convertWebmToGif,
): Promise<void> {
  const document = load(file);
  const gif = await convert(webmPath);

  const documentDirectory = path.dirname(path.resolve(file));
  const stem = path.basename(file, path.extname(file));
  const imageCount = document.entries.filter((entry) => entry.kind === 'image').length;
  const generated = `${stem}-video-${String(imageCount + 1)}.gif`;

  writeFileSync(path.join(documentDirectory, generated), gif);
  document.entries.push({ kind: 'image', alt, path: generated });
  save(file, document);
  rmSync(webmPath);
}

/** Remove and return the most recent entry (an exec drops its code *and* output). */
export function pop(file: string): Entry | undefined {
  const document = load(file);
  const removed = document.entries.pop();
  save(file, document);
  return removed;
}

export interface VerifyDiff {
  index: number;
  lang: string;
  code: string;
  expected: string;
  actual: string;
}

export interface VerifyResult {
  ok: boolean;
  diffs: VerifyDiff[];
  /** Total exec blocks that were re-run (image/note entries are skipped). */
  checked: number;
}

/**
 * Re-run every exec block and diff the fresh output against what was recorded.
 * `outputFile`, when given, writes a copy of the doc with refreshed outputs.
 */
export function verify(file: string, workdir: string, outputFile?: string): VerifyResult {
  const document = load(file);
  const diffs: VerifyDiff[] = [];
  let checked = 0;

  const entries = document.entries.map((entry): Entry => {
    if (entry.kind !== 'exec') return entry;
    checked += 1;
    const result = runCode(entry.lang, entry.code, workdir);
    if (result.output !== entry.output) {
      diffs.push({
        index: checked,
        lang: entry.lang,
        code: entry.code,
        expected: entry.output,
        actual: result.output,
      });
    }
    return { ...entry, output: result.output };
  });

  if (outputFile !== undefined) save(outputFile, { ...document, entries });
  return { ok: diffs.length === 0, diffs, checked };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/** Emit the sequence of showboat commands that would recreate the doc. */
export function extract(file: string, filename?: string): string {
  const document = load(file);
  const target = filename ?? file;
  const lines = [`showboat init ${shellQuote(target)} ${shellQuote(document.title)}`];
  for (const entry of document.entries) {
    switch (entry.kind) {
      case 'note': {
        lines.push(`showboat note ${shellQuote(target)} ${shellQuote(entry.text)}`);
        break;
      }
      case 'exec': {
        const lang = entry.lang || 'bash';
        lines.push(
          `showboat exec ${shellQuote(target)} ${shellQuote(lang)} ${shellQuote(entry.code)}`,
        );
        break;
      }
      case 'image': {
        lines.push(
          `showboat image ${shellQuote(target)} ${shellQuote(`![${entry.alt}](${entry.path})`)}`,
        );
        break;
      }
    }
  }
  return lines.join('\n');
}

/**
 * Extract `owner/repo` from any git remote URL: SSH (`git@host:owner/repo.git`),
 * HTTPS (`https://host/owner/repo.git`), or the sandbox's local git proxy
 * (`http://127.0.0.1:PORT/git/owner/repo`). The host is irrelevant — we always link
 * to github.com — so we just strip the scheme/host/scp prefix and take the last two
 * path segments.
 */
function parseOwnerRepo(remoteUrl: string): string {
  const repoPath = remoteUrl
    .trim()
    .replace(/\.git$/, '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, '') // scheme://host/  → strip
    .replace(/^[^@/]+@[^:/]+:/, ''); // scp-like git@host: → strip
  const segments = repoPath.split('/').filter(Boolean);
  const repo = segments.at(-1);
  const owner = segments.at(-2);
  if (!owner || !repo) throw new Error(`cannot parse owner/repo from remote "${remoteUrl}"`);
  return `${owner}/${repo}`;
}

/**
 * Build the Markdown for the live, clickable PR demo link: a GitHub **blob** URL on
 * `branch` (which renders the doc — images and all — instead of raw source). `docPath`
 * is repo-root-relative, exactly as passed to the other showboat commands.
 */
export function formatDemoLink(remoteUrl: string, branch: string, docPath: string): string {
  const cleanPath = docPath
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.?\/+/, '');
  const url = `https://github.com/${parseOwnerRepo(remoteUrl)}/blob/${branch}/${cleanPath}`;
  return `📝 **Demo:** [${cleanPath}](${url})`;
}

/** Git context for {@link prLink}; injectable so tests don't need a real repo/remote. */
export interface GitContext {
  remoteUrl: string;
  branch: string;
}

/**
 * The current git branch, or `undefined` when it can't be determined — a detached
 * HEAD (git prints `HEAD`), no repo, or no git. `init` uses it to default the branch
 * stamped into a new doc's front matter; an undefined result simply omits it (and
 * `demo-lint` skips a branch it can't determine anyway).
 */
export function currentBranch(): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  const branch = result.stdout.trim();
  return branch.length === 0 || branch === 'HEAD' ? undefined : branch;
}

function git(args: readonly string[]): string {
  const result = spawnSync('git', [...args], { encoding: 'utf8' });
  // A non-zero / null status covers both a git error and a failure to spawn at all
  // (status is null then, and stdout would be null too) — bail before touching stdout.
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
  const output = result.stdout.trim();
  if (output.length === 0) throw new Error(`git ${args.join(' ')} produced no output`);
  return output;
}

/**
 * Produce the live PR demo link for `docPath`, deriving `owner/repo` from the `origin`
 * remote and the branch from `HEAD` — no hardcoding. Paste the output into the PR body
 * (or pass it to `gh pr edit --body` / the update_pull_request MCP tool) when you open or
 * update the PR.
 */
export function prLink(docPath: string, context?: GitContext): string {
  const remoteUrl = context?.remoteUrl ?? git(['remote', 'get-url', 'origin']);
  const branch = context?.branch ?? git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return formatDemoLink(remoteUrl, branch, docPath);
}
