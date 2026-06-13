import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Files allowed to sit directly in `docs/demos/`. Everything else there is a demo
 * artifact that must live inside its own folder (see the `no-root-files` rule).
 */
export const ALLOWED_ROOT_FILES: ReadonlySet<string> = new Set(['README.md']);

/**
 * Branches treated as trunk: the `branch-folder` rule does not apply on them
 * (you only owe a branch-named demo folder while developing a feature branch).
 */
export const TRUNK_BRANCHES: ReadonlySet<string> = new Set(['main', 'master']);

/**
 * Everything a demo-lint rule needs to know about the demos directory, gathered
 * once up front so rules stay pure functions of this shape. Adding a field here is
 * how you give a new rule more to work with.
 */
export interface DemosContext {
  /** Absolute path to the demos directory (`docs/demos`). */
  readonly demosDir: string;
  /** Path shown in findings (relative to the invocation cwd when possible). */
  readonly displayPath: string;
  /** Names of plain files sitting directly in `demosDir`, sorted. */
  readonly rootFiles: readonly string[];
  /** Current git branch, or `undefined` when detached / git is unavailable. */
  readonly branch: string | undefined;
  /**
   * `demosDir`-relative path of the folder this branch owes — the branch name
   * verbatim (slashes kept, so `claude/foo` nests). `undefined` on trunk, a
   * detached HEAD, or when git can't tell us the branch.
   */
  readonly branchFolder: string | undefined;
  /** True when `branchFolder` exists, is a directory, and holds at least one entry. */
  readonly branchFolderHasContent: boolean;
  /**
   * Branches declared in the `branch:` YAML front matter of any demo doc anywhere
   * under `demosDir`, sorted and de-duplicated. This is how a demo claims a branch
   * without naming its folder after it — letting the folder be a semantic feature
   * name (the `branch-folder` rule reads this).
   */
  readonly declaredBranches: readonly string[];
}

/**
 * A lexicographic sort that returns a copy. `unicorn/no-array-sort` forbids the
 * mutating `.sort()`, and `toSorted()` needs ES2023 while this package targets
 * ES2022 — so use an explicit insertion loop (matching `tools/skill-lint`).
 */
function sorted(items: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const insertAt = out.findIndex((existing) => existing > item);
    if (insertAt === -1) out.push(item);
    else out.splice(insertAt, 0, item);
  }
  return out;
}

function listRootFiles(demosDir: string): string[] {
  return sorted(
    readdirSync(demosDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  );
}

/**
 * Read the `branch` declared in a demo doc's leading YAML front matter, or
 * `undefined` when the file has no front matter, no `branch:` key, an empty value,
 * or can't be read. Front matter must be the first thing in the file (`---` … `---`);
 * the value may be quoted. Kept intentionally small — demo-lint only needs this one
 * scalar, not a full YAML parser.
 */
export function readDeclaredBranch(file: string): string | undefined {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!block) return undefined;
  for (const line of (block[1] ?? '').split(/\r?\n/)) {
    const match = /^branch:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = (match[1] ?? '').trim().replaceAll(/^['"]|['"]$/g, '');
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/** Recursively collect the paths of every `*.md` file under `dir`. */
function listMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listMarkdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

/** Branches declared in front matter across every demo doc, sorted and de-duplicated. */
function collectDeclaredBranches(demosDir: string): string[] {
  const branches: string[] = [];
  for (const file of listMarkdownFiles(demosDir)) {
    const branch = readDeclaredBranch(file);
    if (branch !== undefined && !branches.includes(branch)) branches.push(branch);
  }
  return sorted(branches);
}

/** True when `dir` exists, is a directory, and is not empty. */
function isNonEmptyDir(dir: string): boolean {
  try {
    if (!statSync(dir).isDirectory()) return false;
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * The current branch via `git`, or `undefined` when it can't be determined — a
 * detached HEAD (`git` prints `HEAD`), no repo, or no `git` at all. A missing
 * branch makes the `branch-folder` rule skip rather than fire spuriously.
 */
export function currentBranch(): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  const branch = result.stdout.trim();
  if (branch.length === 0 || branch === 'HEAD') return undefined;
  return branch;
}

/**
 * Parse the demos directory and the branch context rules consume. `branch` is a
 * plain value (the CLI reads it from {@link currentBranch}); pass `undefined` for
 * "branch unknown", which makes the `branch-folder` rule skip.
 */
export function gatherDemos(
  demosDir: string,
  cwd: string = process.cwd(),
  branch?: string,
): DemosContext {
  const absolute = path.resolve(demosDir);
  const isTrunk = branch !== undefined && TRUNK_BRANCHES.has(branch);
  const branchFolder = branch === undefined || isTrunk ? undefined : branch;
  return {
    demosDir: absolute,
    displayPath: path.relative(cwd, absolute) || absolute,
    rootFiles: listRootFiles(absolute),
    branch,
    branchFolder,
    branchFolderHasContent:
      branchFolder === undefined ? false : isNonEmptyDir(path.join(absolute, branchFolder)),
    declaredBranches: collectDeclaredBranches(absolute),
  };
}
