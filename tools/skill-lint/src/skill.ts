import { existsSync, globSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** A single markdown heading parsed out of a SKILL.md body. */
export interface Heading {
  /** Number of leading `#` characters (1 = H1, 2 = H2, …). */
  readonly level: number;
  /** The heading text, trimmed of `#` markers and surrounding whitespace. */
  readonly text: string;
  /** 1-based line number within the body. */
  readonly line: number;
}

/**
 * Everything a lint rule needs to know about one skill, parsed once up front so
 * rules stay pure functions of this shape. Adding a field here is how you give a
 * new rule more to work with.
 */
export interface SkillContext {
  /** Absolute path to the skill directory. */
  readonly dir: string;
  /** Absolute path to the skill's SKILL.md. */
  readonly skillMdPath: string;
  /** Path shown in findings (relative to the invocation cwd when possible). */
  readonly displayPath: string;
  /** `name` from the frontmatter, falling back to the directory name. */
  readonly name: string;
  /** `description` from the frontmatter, folded to a single string. */
  readonly description: string;
  /** The markdown body (everything after the frontmatter). */
  readonly body: string;
  /** Number of non-empty-trailing lines in the body. */
  readonly bodyLineCount: number;
  /** Names of the bundled-resource subdirectories (`references`, `scripts`, …). */
  readonly resourceDirs: readonly string[];
  /** True when the skill bundles at least one resource directory. */
  readonly isCompound: boolean;
  /** Headings parsed from the body (code fences excluded). */
  readonly headings: readonly Heading[];
}

const BLOCK_SCALAR_INDICATORS = new Set(['>', '|', '>-', '|-', '>+', '|+']);

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { frontmatter: '', body: raw };
  return { frontmatter: match[1] ?? '', body: match[2] ?? '' };
}

function unquote(value: string): string {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  return quoted ? value.slice(1, -1) : value;
}

/**
 * Read a top-level scalar out of YAML-ish frontmatter, handling both an inline
 * value (`description: text`) and a folded/literal block scalar
 * (`description: >` followed by indented lines). Block scalars are folded to a
 * single space-joined string so a length check sees what the model sees.
 */
function readScalar(frontmatter: string, key: string): string | undefined {
  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index === -1) return undefined;

  const keyLine = lines[index] ?? '';
  const afterColon = keyLine.slice(key.length + 1).trim();
  if (afterColon.length > 0 && !BLOCK_SCALAR_INDICATORS.has(afterColon)) {
    return unquote(afterColon);
  }

  const keyIndent = keyLine.length - keyLine.trimStart().length;
  const collected: string[] = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      collected.push('');
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= keyIndent) break;
    collected.push(line.trim());
  }
  return collected.join(' ').replaceAll(/\s+/g, ' ').trim();
}

function parseHeadings(body: string): Heading[] {
  const headings: Heading[] = [];
  let fence: string | undefined;
  for (const [index, line] of body.split(/\r?\n/).entries()) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = (fenceMatch[1] ?? '')[0] ?? '`';
      if (fence === undefined) fence = marker;
      else if (fence === marker) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;

    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (headingMatch) {
      headings.push({
        level: (headingMatch[1] ?? '').length,
        text: (headingMatch[2] ?? '').trim(),
        line: index + 1,
      });
    }
  }
  return headings;
}

/**
 * A lexicographic sort that returns a copy. `unicorn/no-array-sort` forbids the
 * mutating `.sort()`, and `toSorted()` needs ES2023 while this package targets
 * ES2022 — so, like `frontend/lib/tree.ts`, use an explicit insertion loop.
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

function listResourceDirs(dir: string): string[] {
  return sorted(
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
}

function countLines(body: string): number {
  const trimmed = body.replace(/(\r?\n)+$/, '');
  return trimmed === '' ? 0 : trimmed.split(/\r?\n/).length;
}

/** Parse a single SKILL.md into the {@link SkillContext} rules consume. */
export function parseSkill(skillMdPath: string, cwd: string = process.cwd()): SkillContext {
  const absolute = path.resolve(skillMdPath);
  const raw = readFileSync(absolute, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  const dir = path.dirname(absolute);
  const resourceDirs = listResourceDirs(dir);
  return {
    dir,
    skillMdPath: absolute,
    displayPath: path.relative(cwd, absolute) || absolute,
    name: readScalar(frontmatter, 'name') ?? path.basename(dir),
    description: readScalar(frontmatter, 'description') ?? '',
    body,
    bodyLineCount: countLines(body),
    resourceDirs,
    isCompound: resourceDirs.length > 0,
    headings: parseHeadings(body),
  };
}

function addSkillMd(target: string, found: Set<string>): void {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    return;
  }
  if (!stats.isDirectory()) {
    found.add(target);
    return;
  }
  const own = path.join(target, 'SKILL.md');
  if (existsSync(own)) {
    found.add(own);
    return;
  }
  // A directory of skills (e.g. `.claude/skills`): take each child's SKILL.md.
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(target, entry.name, 'SKILL.md');
    if (existsSync(nested)) found.add(nested);
  }
}

/**
 * Turn the CLI's path/glob arguments into a sorted, de-duplicated list of
 * SKILL.md files. Each argument may be a SKILL.md file, a skill directory, a
 * directory of skills, or a glob. With no arguments, falls back to `defaultDir`.
 */
export function resolveSkillMdPaths(
  inputs: readonly string[],
  cwd: string,
  defaultDir: string,
): string[] {
  const found = new Set<string>();
  if (inputs.length === 0) {
    addSkillMd(path.resolve(defaultDir), found);
    return sorted([...found]);
  }
  for (const pattern of inputs) {
    const matches = globSync(pattern, { cwd });
    if (matches.length === 0) {
      const literal = path.resolve(cwd, pattern);
      if (existsSync(literal)) addSkillMd(literal, found);
      continue;
    }
    for (const match of matches) addSkillMd(path.resolve(cwd, match), found);
  }
  return sorted([...found]);
}
