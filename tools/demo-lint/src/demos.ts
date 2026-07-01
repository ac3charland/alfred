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
  /**
   * Contents of every `*.md` file found anywhere under `demosDir`. Each entry has a
   * path relative to `demosDir` and the raw file text. Rules that need to inspect
   * demo content (e.g. banned command patterns) read from this field.
   */
  readonly demoContents: readonly { relativePath: string; content: string }[];
  /**
   * True when this branch changed at least one path outside `docs/` — meaning it owes
   * a demo. A docs-only branch (every change under `docs/`) is exempt from
   * `branch-folder`. **Conservative default:** when the diff is unknown (git
   * unavailable, no trunk ref, or a failed command) this is `true`, so we never grant
   * the exception on a guess.
   */
  readonly hasChangesOutsideDocs: boolean;
  /**
   * The trunk ref this branch is *behind* — trunk has commits not reachable from HEAD —
   * or `undefined` when the branch is up to date, trunk is unknown, or git can't tell. A
   * stale base inflates the changed-since-trunk set with trunk's own intervening (often
   * non-docs) commits, which can wrongly suppress the docs-only `branch-folder` exemption;
   * the rule surfaces the rebase fix when this is set (see the demo-lint skill).
   */
  readonly staleBaseTrunkRef: string | undefined;
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

/** Raw text of every `*.md` file under `demosDir`, keyed by path relative to `demosDir`. */
function collectDemoContents(demosDir: string): { relativePath: string; content: string }[] {
  return listMarkdownFiles(demosDir).map((file) => ({
    relativePath: path.relative(demosDir, file),
    content: readFileSync(file, 'utf8'),
  }));
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

/** A path counts as docs iff it is `docs` itself or sits under `docs/`. */
function isDocsPath(p: string): boolean {
  return p === 'docs' || p.startsWith('docs/');
}

/** Remote-tracking trunk refs, in priority order — what a fresh CI checkout diffs against. */
const REMOTE_TRUNK_REFS: readonly string[] = ['origin/main', 'origin/master'];
/** Local trunk branches — a LAST resort, used only when there is no `origin` remote. */
const LOCAL_TRUNK_REFS: readonly string[] = ['main', 'master'];

/**
 * The git facts {@link chooseTrunkRef} needs, gathered up front so the choice itself stays a
 * pure (unit-testable) function rather than shelling out.
 */
export interface TrunkRefFacts {
  /** `origin/<branch>` resolved from `refs/remotes/origin/HEAD`, when that ref is set. */
  readonly originHead: string | undefined;
  /** Remote-tracking trunk refs that exist, in priority order. */
  readonly remote: readonly string[];
  /** Local trunk branches that exist, in priority order. */
  readonly local: readonly string[];
  /** Whether an `origin` remote is configured at all. */
  readonly hasOrigin: boolean;
}

/**
 * Choose the ref to diff against for the changed-since-trunk set. Prefers the **remote**
 * trunk — the same ref a fresh CI checkout uses — so the gate flags the same demos locally
 * and in CI. Crucially this never falls back to a **stale local `main`** (one left behind its
 * origin): a stale local trunk pushes the merge-base into the distant past and retroactively
 * lints every demo merged since, which is exactly the false positive this avoids. A local
 * trunk branch is used only when there is no `origin` remote at all (a standalone repo); with
 * an origin remote present but its trunk ref missing locally, we return `undefined` ("trunk
 * unknown") rather than trust a possibly-stale local branch.
 */
export function chooseTrunkRef(facts: TrunkRefFacts): string | undefined {
  if (facts.originHead !== undefined) return facts.originHead;
  if (facts.remote.length > 0) return facts.remote[0];
  if (facts.hasOrigin) return undefined;
  return facts.local[0];
}

/** True when the git ref resolves to a commit. */
function refExists(ref: string): boolean {
  return (
    spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { encoding: 'utf8' }).status === 0
  );
}

/** `origin/<branch>` from the remote's default-branch symbolic ref, when set and resolvable. */
function resolveOriginHead(): string | undefined {
  const result = spawnSync('git', ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return undefined;
  const ref = result.stdout.trim().replace(/^refs\/remotes\//, '');
  return ref.length > 0 && refExists(ref) ? ref : undefined;
}

/** Whether an `origin` remote is configured. */
function hasOriginRemote(): boolean {
  const result = spawnSync('git', ['remote'], { encoding: 'utf8' });
  if (result.status !== 0) return false;
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .includes('origin');
}

/** Gather the trunk-ref facts from git for {@link chooseTrunkRef}. */
function gatherTrunkRefFacts(): TrunkRefFacts {
  return {
    originHead: resolveOriginHead(),
    remote: REMOTE_TRUNK_REFS.filter((ref) => refExists(ref)),
    local: LOCAL_TRUNK_REFS.filter((ref) => refExists(ref)),
    hasOrigin: hasOriginRemote(),
  };
}

/**
 * Repo-relative paths changed on the current branch vs the trunk merge-base, or
 * `undefined` when git can't tell us — no git, no usable trunk ref (see
 * {@link chooseTrunkRef}), or any command failing. Git emits POSIX, repo-relative paths
 * already; we trim and drop blank lines. The CLI passes this into {@link gatherDemos}
 * (mirroring how it passes {@link currentBranch}); an `undefined` result yields the
 * conservative `hasChangesOutsideDocs === true` default.
 */
export function changedPathsSinceTrunk(): readonly string[] | undefined {
  const trunk = chooseTrunkRef(gatherTrunkRefFacts());
  if (trunk === undefined) return undefined;
  const base = spawnSync('git', ['merge-base', 'HEAD', trunk], { encoding: 'utf8' });
  if (base.status !== 0) return undefined;
  const mergeBase = base.stdout.trim();
  if (mergeBase.length === 0) return undefined;
  const diff = spawnSync('git', ['diff', '--name-only', mergeBase, 'HEAD'], { encoding: 'utf8' });
  if (diff.status !== 0) return undefined;
  return diff.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The trunk ref this branch is *behind* — trunk has commits not reachable from HEAD — or
 * `undefined` when the branch is up to date, trunk is unknown (see {@link chooseTrunkRef}),
 * or git can't tell (no git, or a failed command). Uses the SAME trunk ref
 * {@link changedPathsSinceTrunk} diffs against, so "behind" lines up exactly with the
 * inflated changed-set it produces. The CLI passes this into {@link gatherDemos}; the
 * `branch-folder` rule reads it to add the rebase hint when a docs-only branch is masked by
 * a stale base.
 */
export function trunkRefIfBehind(): string | undefined {
  const trunk = chooseTrunkRef(gatherTrunkRefFacts());
  if (trunk === undefined) return undefined;
  const behind = spawnSync('git', ['rev-list', '--count', `HEAD..${trunk}`], { encoding: 'utf8' });
  if (behind.status !== 0) return undefined;
  return Number(behind.stdout.trim()) > 0 ? trunk : undefined;
}

/** A changed path under `docs/demos/<key>` → the `<key>`: a demo folder or a root file name. */
const DEMO_PATH = /(?:^|\/)docs\/demos\/([^/]+)/;

/**
 * The set of demo "keys" touched by `changedPaths` — a key is the first segment under
 * `docs/demos/`: a demo folder name (`foo` for `docs/demos/foo/bar.md`) or a root file name
 * (`stray.md` for `docs/demos/stray.md`). `undefined` when the diff is unknown (mirrors
 * {@link changedPathsSinceTrunk}), the caller's signal to lint **every** demo rather than
 * silently skip on a guess.
 */
export function changedDemoKeys(changedPaths?: readonly string[]): Set<string> | undefined {
  if (changedPaths === undefined) return undefined;
  const keys = new Set<string>();
  for (const changed of changedPaths) {
    const match = DEMO_PATH.exec(changed);
    if (match?.[1] !== undefined) keys.add(match[1]);
  }
  return keys;
}

/** The demo key a `demosDir`-relative path belongs to — its first path segment. */
function demoKeyOf(relativePath: string): string {
  return relativePath.split(/[/\\]/, 1)[0] ?? relativePath;
}

/**
 * Parse the demos directory and the branch context rules consume. `branch` is a
 * plain value (the CLI reads it from {@link currentBranch}); pass `undefined` for
 * "branch unknown", which makes the `branch-folder` rule skip. `changedPaths` is the
 * repo-relative diff vs trunk (the CLI reads it from {@link changedPathsSinceTrunk});
 * pass `undefined` for "diff unknown", which conservatively keeps
 * `hasChangesOutsideDocs === true` so no docs-only exception is granted on a guess.
 *
 * `changedOnly` is the gate mode: when `true`, the content/structure inputs (`demoContents`
 * and `rootFiles`) are narrowed to demos touched on this branch vs trunk, so a newly-added
 * rule never retroactively fails an untouched demo. An unknown diff still lints every demo.
 * `branchFolder` / `declaredBranches` stay computed over all demos — the branch-folder rule
 * needs the whole picture regardless of what changed.
 *
 * `staleBaseTrunkRef` is the trunk ref this branch is behind (the CLI reads it from
 * {@link trunkRefIfBehind}); it feeds the branch-folder rule's rebase hint. Pass `undefined`
 * for "up to date / unknown".
 */
export function gatherDemos(
  demosDir: string,
  cwd: string = process.cwd(),
  branch?: string,
  changedPaths?: readonly string[],
  changedOnly = false,
  staleBaseTrunkRef?: string,
): DemosContext {
  const absolute = path.resolve(demosDir);
  const isTrunk = branch !== undefined && TRUNK_BRANCHES.has(branch);
  const branchFolder = branch === undefined || isTrunk ? undefined : branch;
  // `undefined` keys (not in changed-only mode, or an unknown diff) keeps everything.
  const changedKeys = changedOnly ? changedDemoKeys(changedPaths) : undefined;
  const keep = (relativePath: string): boolean =>
    changedKeys === undefined || changedKeys.has(demoKeyOf(relativePath));
  return {
    demosDir: absolute,
    displayPath: path.relative(cwd, absolute) || absolute,
    rootFiles: listRootFiles(absolute).filter((name) => keep(name)),
    branch,
    branchFolder,
    branchFolderHasContent:
      branchFolder === undefined ? false : isNonEmptyDir(path.join(absolute, branchFolder)),
    declaredBranches: collectDeclaredBranches(absolute),
    demoContents: collectDemoContents(absolute).filter(({ relativePath }) => keep(relativePath)),
    // Unknown diff (`undefined`) → assume changes outside docs, so we never grant the
    // docs-only `branch-folder` exception on a guess.
    hasChangesOutsideDocs:
      changedPaths === undefined ? true : changedPaths.some((p) => !isDocsPath(p)),
    staleBaseTrunkRef,
  };
}
