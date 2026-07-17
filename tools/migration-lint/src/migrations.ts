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
  /**
   * Every view brought into being by a bare `create view` (NOT `create or replace`), keyed to
   * the LAST such statement — a bare create resets privileges (and a `drop view` before it drops
   * them outright), so this is the point from which a fresh SELECT grant must be re-established.
   * `name` is normalized; `file` is the migration that last freshly-created it.
   */
  readonly createdViews: readonly { name: string; file: string }[];
  /**
   * For each normalized view name, the roles granted SELECT on it by a grant that lands AT OR
   * AFTER the view's last bare `create view` — earlier grants are discarded on recreate, exactly
   * as Postgres drops them. Order-aware (unlike {@link sequenceUsageGrants}) so a stale grant from
   * before a `drop view`/`create view` can't mask a missing re-grant.
   */
  readonly viewSelectGrants: ReadonlyMap<string, ReadonlySet<string>>;
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
 * Strip everything that isn't executable SQL so prose can't trip the matchers: dollar-quoted
 * blocks (function bodies), line + block comments, and single-quoted string literals are each
 * replaced with neutral filler (a space, or an empty literal `''` for strings), so a
 * `create sequence` / `create view` mentioned in a comment, string, or function body never counts
 * as a real statement.
 *
 * This is a SINGLE forward pass, not four independent `replaceAll`s, because comments and string
 * literals are mutually-exclusive lexical contexts that cannot be stripped in isolation: an
 * apostrophe in a `--` prose comment (e.g. "the story's project") would, if strings were stripped
 * before comments, open a phantom string literal that swallows the real SQL up to the next quote —
 * silently blinding every rule to statements in between. Scanning left-to-right and dispatching on
 * whichever context opens first keeps each delimiter honoured only in code position.
 */
export function stripNonCode(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const rest = sql.slice(i);

    // Dollar-quoted block ($tag$ … $tag$): opaque function body. Skip to the matching close tag.
    const dollarOpen = /^\$([A-Za-z0-9_]*)\$/.exec(rest);
    if (dollarOpen) {
      const tag = dollarOpen[0];
      const close = sql.indexOf(tag, i + tag.length);
      i = close === -1 ? n : close + tag.length;
      out += ' ';
      continue;
    }

    // Line comment: to end of line (the newline itself is preserved as code).
    if (rest.startsWith('--')) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      out += ' ';
      continue;
    }

    // Block comment: to the closing `*/` (nesting is not handled — no migration relies on it).
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
      continue;
    }

    // Single-quoted string literal, with `''` as the embedded-quote escape.
    if (rest.startsWith("'")) {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2; // escaped quote — stay in the string
            continue;
          }
          j += 1; // closing quote
          break;
        }
        j += 1;
      }
      i = j;
      out += "''";
      continue;
    }

    out += sql.charAt(i);
    i += 1;
  }
  return out;
}

/**
 * One privilege event touching a view, tagged with its character offset in the stripped SQL so
 * {@link gatherMigrations} can replay creates and grants in true source order within a file.
 */
export interface ViewEvent {
  /** `create` = a bare `create view` (resets grants); `grant` = a SELECT grant on the view. */
  readonly kind: 'create' | 'grant';
  /** Normalized view name. */
  readonly name: string;
  /** Roles the grant confers SELECT to (empty for a `create`). */
  readonly roles: readonly string[];
  /** Offset of the match in the stripped SQL — the intra-file ordering key. */
  readonly offset: number;
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
  /** Bare `create view` and view SELECT-grant events, sorted by source offset. */
  readonly viewEvents: readonly ViewEvent[];
}

/** True when a grant's privilege list confers USAGE — an explicit `usage`, `all`, or `all privileges`. */
const USAGE_PRIVILEGES: ReadonlySet<string> = new Set(['usage', 'all', 'all privileges']);

function confersUsage(privileges: string): boolean {
  return hasPrivilege(privileges, USAGE_PRIVILEGES);
}

/** True when a grant's privilege list confers SELECT — an explicit `select`, `all`, or `all privileges`. */
const SELECT_PRIVILEGES: ReadonlySet<string> = new Set(['select', 'all', 'all privileges']);

function confersSelect(privileges: string): boolean {
  return hasPrivilege(privileges, SELECT_PRIVILEGES);
}

/** True when any comma-separated privilege in `privileges` is in `wanted` (case/space-insensitive). */
function hasPrivilege(privileges: string, wanted: ReadonlySet<string>): boolean {
  return privileges
    .split(',')
    .map((privilege) => privilege.trim().toLowerCase())
    .some((privilege) => wanted.has(privilege));
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

  const viewEvents = parseViewEvents(stripped, ident);

  return { createdSequences, usageGrants, viewEvents };
}

/**
 * Parse the bare-`create view` and view SELECT-grant events out of stripped SQL, tagged with
 * their source offset so callers can replay them in order. `create or replace view` is skipped
 * (it preserves privileges); only a bare `create view` (the drop/recreate shape that resets them)
 * counts. Grants are matched over a comma-separated object list — the same `grant … on a, b to …`
 * shape used for tables — and the object-type keywords with their own grant syntax (`sequence`,
 * `function`, …) are excluded so only table/view targets are captured.
 */
function parseViewEvents(stripped: string, ident: string): ViewEvent[] {
  const events: ViewEvent[] = [];

  // A bare `create view <name>` — the `create\s+view` gap can't span the `or replace` of a
  // `create or replace view`, so replaces are naturally excluded.
  const createRe = new RegExp(String.raw`\bcreate\s+view\s+(${ident})`, 'gi');
  let createMatch: RegExpExecArray | null;
  while ((createMatch = createRe.exec(stripped)) !== null) {
    events.push({
      kind: 'create',
      name: normalizeName(createMatch[1] ?? ''),
      roles: [],
      offset: createMatch.index,
    });
  }

  // `grant <privs> on [table] <obj, obj, …> to <roles>;`. The negative lookahead after `on`
  // skips the object types that have their own grant forms (so `grant … on sequence …` is not
  // read as a view grant); an optional `table` keyword is consumed when present.
  const objectList = String.raw`${ident}(?:\s*,\s*${ident})*`;
  const grantViewRe = new RegExp(
    String.raw`\bgrant\b([^;]+?)\bon\s+(?!sequence\b|function\b|schema\b|database\b|domain\b|type\b|routine\b|foreign\b|large\b|all\b)(?:table\s+)?(${objectList})\s+to\b([^;]+?);`,
    'gi',
  );
  let grantMatch: RegExpExecArray | null;
  while ((grantMatch = grantViewRe.exec(stripped)) !== null) {
    if (!confersSelect(grantMatch[1] ?? '')) continue;
    const roles = parseRoles(grantMatch[3] ?? '');
    for (const object of (grantMatch[2] ?? '').split(',')) {
      const name = normalizeName(object.trim());
      if (name.length > 0) events.push({ kind: 'grant', name, roles, offset: grantMatch.index });
    }
  }

  return sortedByOffset(events);
}

/** Sort view events by source offset, returning a copy (`unicorn/no-array-sort` forbids in-place). */
function sortedByOffset(events: readonly ViewEvent[]): ViewEvent[] {
  const out: ViewEvent[] = [];
  for (const event of events) {
    const insertAt = out.findIndex((existing) => existing.offset > event.offset);
    if (insertAt === -1) out.push(event);
    else out.splice(insertAt, 0, event);
  }
  return out;
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
  // View privileges are order-sensitive: a bare `create view` (or the `drop view` before it) wipes
  // prior grants, so track the last freshly-created file per view and reset its grant set there.
  const viewCreateFile = new Map<string, string>();
  const viewSelectGrants = new Map<string, Set<string>>();

  for (const file of listSqlFiles(absolute)) {
    const stripped = stripNonCode(readFileSync(path.join(absolute, file), 'utf8'));
    const parsed = parseSql(stripped);
    for (const name of parsed.createdSequences) createdSequences.push({ name, file });
    for (const [sequence, roles] of parsed.usageGrants) {
      const existing = sequenceUsageGrants.get(sequence) ?? new Set<string>();
      for (const role of roles) existing.add(role);
      sequenceUsageGrants.set(sequence, existing);
    }
    // Replay this file's create/grant events in source order (already sorted by offset), across
    // files in filename order — exactly how Postgres applies them.
    for (const event of parsed.viewEvents) {
      if (event.kind === 'create') {
        viewCreateFile.set(event.name, file);
        viewSelectGrants.set(event.name, new Set()); // recreate ⇒ prior grants dropped
      } else {
        const existing = viewSelectGrants.get(event.name) ?? new Set<string>();
        for (const role of event.roles) existing.add(role);
        viewSelectGrants.set(event.name, existing);
      }
    }
  }

  const createdViews = [...viewCreateFile].map(([name, file]) => ({ name, file }));

  return {
    migrationsDir: absolute,
    displayPath: path.relative(cwd, absolute) || absolute,
    createdSequences,
    sequenceUsageGrants,
    createdViews,
    viewSelectGrants,
  };
}
