import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Everything a migration-lint rule needs to know about the migrations directory,
 * gathered once up front so rules stay pure functions of this shape. Adding a field
 * here is how you give a new rule more to work with.
 */
export interface MigrationsContext {
  /** Absolute path to the migrations directory (`database/migrations`). */
  readonly migrationsDir: string;
  /** Path shown in findings (relative to the invocation cwd when possible). */
  readonly displayPath: string;
  /**
   * Every sequence created across all migrations, in the order encountered. The
   * `name` is normalized (schema dropped, unquoted, lowercased); `file` is the
   * migration filename that created it (shown in findings).
   */
  readonly createdSequences: readonly { name: string; file: string }[];
  /**
   * For each normalized sequence name, the set of normalized roles granted USAGE
   * on it (via an explicit `usage`, `all`, or `all privileges` grant) anywhere in
   * the migrations. Aggregated across files so a later migration's grant satisfies
   * an earlier migration's `create sequence` (mirroring how Postgres applies them).
   */
  readonly sequenceUsageGrants: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * A lexicographic sort that returns a copy. `unicorn/no-array-sort` forbids the
 * mutating `.sort()`, and `toSorted()` needs ES2023 while this package targets
 * ES2022 — so use an explicit insertion loop (matching `tools/demo-lint`).
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

// src/migrations.ts → repo root is three levels up, then into the migrations directory.
export const DEFAULT_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../database/migrations',
);

/**
 * Normalize a SQL identifier to the bare object name we match on: strip surrounding
 * double-quotes, drop the schema (keep the segment after the last `.`), and lowercase.
 * So `public."Foo_Seq"` and `Foo_Seq` both become `foo_seq`.
 */
export function normalizeName(raw: string): string {
  const unquoted = raw.replaceAll('"', '');
  const bare = unquoted.split('.').at(-1) ?? unquoted;
  return bare.toLowerCase();
}

/**
 * Strip everything that isn't executable SQL so prose can't trip the matchers, in
 * this order: dollar-quoted blocks (function bodies), block comments, single-quoted
 * string literals, then line comments. Each is replaced with neutral filler (a space,
 * or an empty literal for strings) so a `create sequence` mentioned in a comment,
 * string, or function body never counts as a real statement.
 */
export function stripNonCode(sql: string): string {
  return sql
    .replaceAll(/\$([A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g, ' ')
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replaceAll(/'(?:[^']|'')*'/g, "''")
    .replaceAll(/--[^\n]*/g, ' ');
}

/** The created sequences and USAGE grants parsed out of a single stripped SQL string. */
export interface ParsedSql {
  /** Normalized names of sequences created by `create sequence`. */
  readonly createdSequences: readonly string[];
  /**
   * For each normalized sequence name, the normalized roles granted USAGE on it
   * (an explicit `usage`, `all`, or `all privileges` privilege list).
   */
  readonly usageGrants: ReadonlyMap<string, ReadonlySet<string>>;
}

/** True when a grant's privilege list confers USAGE — an explicit `usage`, `all`, or `all privileges`. */
const USAGE_PRIVILEGES: ReadonlySet<string> = new Set(['usage', 'all', 'all privileges']);

function confersUsage(privileges: string): boolean {
  return privileges
    .split(',')
    .map((privilege) => privilege.trim().toLowerCase())
    .some((privilege) => USAGE_PRIVILEGES.has(privilege));
}

/** Split a comma-separated role list into normalized role names. */
function parseRoles(rawRoles: string): string[] {
  return rawRoles
    .split(',')
    .map((role) => normalizeName(role.trim()))
    .filter((role) => role.length > 0);
}

/**
 * Parse the created sequences and USAGE grants out of stripped SQL. `stripped` must
 * already have run through {@link stripNonCode} so comments / strings / function
 * bodies can't produce false matches.
 */
export function parseSql(stripped: string): ParsedSql {
  // A SQL identifier, possibly schema-qualified and/or double-quoted on either part:
  // matches `foo_seq`, `public.foo_seq`, `"foo_seq"`, and `public."foo_seq"`.
  // `normalizeName` then strips the quotes and schema down to the bare object name.
  const ident = String.raw`(?:"[^"]+"|[A-Za-z0-9_]+)(?:\.(?:"[^"]+"|[A-Za-z0-9_]+))*`;

  const createdSequences: string[] = [];
  const createRe = new RegExp(
    String.raw`\bcreate\s+sequence\s+(?:if\s+not\s+exists\s+)?(${ident})`,
    'gi',
  );
  let createMatch: RegExpExecArray | null;
  while ((createMatch = createRe.exec(stripped)) !== null) {
    createdSequences.push(normalizeName(createMatch[1] ?? ''));
  }

  const usageGrants = new Map<string, Set<string>>();
  // Each group stays within one statement (`[^;]+?`, not `[\s\S]+?`) so a prior
  // `grant … on table …;` can't bleed across the `;` into the next grant's match.
  const grantRe = new RegExp(
    String.raw`\bgrant\b([^;]+?)\bon\s+sequence\s+(${ident})\s+to\b([^;]+?);`,
    'gi',
  );
  let grantMatch: RegExpExecArray | null;
  while ((grantMatch = grantRe.exec(stripped)) !== null) {
    if (!confersUsage(grantMatch[1] ?? '')) continue;
    const sequence = normalizeName(grantMatch[2] ?? '');
    const roles = usageGrants.get(sequence) ?? new Set<string>();
    for (const role of parseRoles(grantMatch[3] ?? '')) roles.add(role);
    usageGrants.set(sequence, roles);
  }

  return { createdSequences, usageGrants };
}

/** Names of the `*.sql` files in `dir`, sorted by filename. */
function listSqlFiles(dir: string): string[] {
  return sorted(
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
      .map((entry) => entry.name),
  );
}

/**
 * Parse the migrations directory into the pure data the rules consume. Reads every
 * `*.sql` file in `migrationsDir` (sorted by filename), strips non-code from each,
 * and aggregates the created sequences and their USAGE grants across all files — so
 * a grant in a later migration satisfies a `create sequence` in an earlier one.
 */
export function gatherMigrations(
  migrationsDir: string,
  cwd: string = process.cwd(),
): MigrationsContext {
  const absolute = path.resolve(migrationsDir);
  const createdSequences: { name: string; file: string }[] = [];
  const sequenceUsageGrants = new Map<string, Set<string>>();

  for (const file of listSqlFiles(absolute)) {
    const stripped = stripNonCode(readFileSync(path.join(absolute, file), 'utf8'));
    const parsed = parseSql(stripped);
    for (const name of parsed.createdSequences) createdSequences.push({ name, file });
    for (const [sequence, roles] of parsed.usageGrants) {
      const existing = sequenceUsageGrants.get(sequence) ?? new Set<string>();
      for (const role of roles) existing.add(role);
      sequenceUsageGrants.set(sequence, existing);
    }
  }

  return {
    migrationsDir: absolute,
    displayPath: path.relative(cwd, absolute) || absolute,
    createdSequences,
    sequenceUsageGrants,
  };
}
