import { mkdirSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { BUILDER_PATH } from './git.ts';
import type { GitHistory } from './git.ts';
import type { BuilderName } from './lane.ts';
import type { JsonObject, LaunchLane } from './types.ts';

/**
 * Rebuilding a launch prompt by running the builder file exactly as it stood at the time. Every
 * historical `links.ts` imports only types, so Node's type stripping turns any version into a
 * standalone module: its `import type` line is erased and nothing else is imported.
 */

type Replay = { prompt: string } | { warning: 'builder_missing' | 'builder_threw' };

type Loaded = { module: Record<string, unknown> } | { failed: string };

export class BuilderLoader {
  readonly #history: GitHistory;
  readonly #tmpDir: string;
  readonly #cache = new Map<string, Promise<Loaded>>();

  constructor(history: GitHistory, tmpDir: string) {
    this.#history = history;
    this.#tmpDir = tmpDir;
  }

  /** The builder module at `sha`, loaded once per sha. */
  #load(sha: string): Promise<Loaded> {
    let loaded = this.#cache.get(sha);
    if (loaded === undefined) {
      loaded = this.#import(sha);
      this.#cache.set(sha, loaded);
    }
    return loaded;
  }

  async #import(sha: string): Promise<Loaded> {
    const source = this.#history.showFile(sha, BUILDER_PATH);
    if (source === null) return { failed: `${BUILDER_PATH} is absent at ${sha}` };
    try {
      // Non-erasable TypeScript (an enum, say) throws here; no historical version uses any.
      const javascript = stripTypeScriptTypes(source);
      const dir = path.join(this.#tmpDir, sha);
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'links.mjs');
      writeFileSync(file, javascript);
      return { module: (await import(pathToFileURL(file).href)) as Record<string, unknown> };
    } catch (error) {
      return { failed: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Whether the builder file at `sha` exports `name` as a function. */
  async has(sha: string | null, name: BuilderName): Promise<boolean> {
    if (sha === null) return false;
    const loaded = await this.#load(sha);
    return 'module' in loaded && typeof loaded.module[name] === 'function';
  }

  /**
   * Run `builder` from the file at `sha` with `(project, subject)` and read the prompt off the
   * URL it returns. A file or export that doesn't exist is `builder_missing`; a builder (or a
   * file) that throws is `builder_threw`.
   */
  async replay(
    sha: string | null,
    builder: BuilderName,
    project: JsonObject,
    subject: JsonObject,
  ): Promise<Replay> {
    if (sha === null) return { warning: 'builder_missing' };
    const loaded = await this.#load(sha);
    if ('failed' in loaded) return { warning: 'builder_threw' };
    const build = loaded.module[builder];
    if (typeof build !== 'function') return { warning: 'builder_missing' };
    const call = build as (project: JsonObject, subject: JsonObject) => unknown;
    try {
      const url = call(project, subject);
      const prompt = typeof url === 'string' ? promptFromUrl(url) : null;
      return prompt === null ? { warning: 'builder_threw' } : { prompt };
    } catch {
      return { warning: 'builder_threw' };
    }
  }
}

/** The prompt a launch URL prefills: `q`, or `prompt` in the builder's earliest versions. */
export function promptFromUrl(url: string): string | null {
  const params = new URL(url).searchParams;
  return params.get('q') ?? params.get('prompt');
}

const SKILL_PATH_RE = /\.claude\/skills\/[a-z0-9-]+\/SKILL\.md/g;

/** Every distinct skill path a prompt names, in order of first appearance. */
export function skillPathsIn(prompt: string): string[] {
  return [...new Set(prompt.match(SKILL_PATH_RE))];
}

/** The spec-path fields a builder may read, on a story or an epic. */
const SPEC_FIELDS = ['spec_path', 'epic_spec_path'] as const;

/**
 * The story or epic as it stood at launch, as far as the spec paths go: each spec-path field
 * keeps its value only if that file existed at base (a first refinement saw no spec yet; a
 * re-refinement saw one). The implementation lane always reads its PR block's spec-path.
 * Title and notes stay today's — nothing recorded them at launch.
 */
export function launchTimeSubject<T extends JsonObject>(
  lane: LaunchLane,
  subject: T,
  blockSpecPath: string | undefined,
  existsAtBase: (file: string) => boolean,
): T {
  const copy: JsonObject = { ...subject };
  for (const field of SPEC_FIELDS) {
    const value = copy[field];
    if (typeof value === 'string' && !existsAtBase(value)) copy[field] = null;
  }
  if (lane === 'implementation' && blockSpecPath !== undefined) copy['spec_path'] = blockSpecPath;
  return copy as T;
}
