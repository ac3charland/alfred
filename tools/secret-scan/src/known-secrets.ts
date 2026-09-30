/**
 * Value-based secret detection: refuse content that contains a secret this process actually holds.
 *
 * Pattern rules (secretlint) only catch shapes they know; the bare password (`printenv PGPASSWORD`),
 * a URI cut off before `@host`, node's `{ password: '…' }`, a `.pgpass` line all slip past. Knowing
 * the live values closes that gap whatever the output looks like.
 *
 * KEEP IN SYNC: this file exists twice, byte for byte — `tools/secret-scan/src/known-secrets.ts` and
 * `tools/showboat/src/known-secrets.ts` (the two packages cannot import each other's TS source). Edit
 * both, and both `known-secrets.test.ts` copies, in the same change.
 *
 * A report NEVER contains a value — only where it came from (`$PGPASSWORD`, `DATABASE_URL in …`).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** A live secret value and how to name where it came from (never the value itself). */
export interface KnownSecret {
  value: string;
  /** e.g. `the value of $PGPASSWORD`, `the password from DATABASE_URL in frontend/.env.local`. */
  source: string;
}

export interface KnownSecretsOptions {
  /** Environment to read; defaults to this process's. */
  env?: Readonly<Record<string, string | undefined>>;
  /**
   * Absolute repo roots whose gitignored dotenv files (`frontend/.env.local`, `workers/.dev.vars`,
   * …) are read too — normally {@link repoEnvRoots}: this checkout and the main one.
   */
  envRoots?: readonly string[];
}

/** Names that hold a credential. */
const SECRET_NAME = /PASS|SECRET|TOKEN|KEY|PWD|JWT|CREDENTIAL/i;
/** Connection-string variables: their password (and the whole URL) is the secret. */
const URL_NAME = /^(DATABASE_URL|SUPABASE_DB_URL)$|(_URL|_URI|_DSN)$/i;
/**
 * Names that match {@link SECRET_NAME} but hold a location, a config name or a public value, never a
 * secret: `PWD`, `*_FILE|_PATH|_DIR|_HOME`, `GIT_CONFIG_*`, `*ASKPASS` (a helper program),
 * `PGPASSFILE`, `PGSSL*` (cert/key paths — but `PGSSLPASSWORD` is a passphrase), and `NEXT_PUBLIC_*`
 * (shipped to the browser by definition).
 */
const NOT_A_SECRET_NAME =
  /^(PWD|OLDPWD|PGPASSFILE)$|_(FILE|PATH|DIR|HOME)$|^GIT_CONFIG_|ASKPASS|^PGSSL(?!PASSWORD$)\w+$|^NEXT_PUBLIC_/i;
/** Never a password whatever the name: an absolute path or a command-line flag. */
const PATH_OR_FLAG_VALUE = /^\/[\w.-]+(\/[\w.-]*)*$|^--\w/;
/** `scheme://user:password@host…` — the password is everything up to the last `@`. */
const URL_WITH_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^:/@\s]*:(.+)@[^@]*$/is;
const URL_SHAPED = /^[a-z][a-z0-9+.-]*:\/\//i;
/** Query parameters that carry a URL's password (`?password=…`), compared decoded and lowercased. */
const PASSWORD_PARAM = /^(ssl)?(password|passwd|pass|pwd)$/;

const MIN_LENGTH = 8;
/** A lowercase word (letters and `._-`) shorter than this is a word, not a generated secret. */
const MIN_WORD_LENGTH = 16;

/** Variables named like a password: a human chose the value, so a lowercase word can be the secret. */
const PASSWORD_NAME = /PASS|PWD/i;
/**
 * Passwords that ship as a default or an example, and that ordinary text and config say constantly.
 * Only the ones of {@link MIN_LENGTH} or more matter (shorter values are trivial anyway); `changeme`
 * is a placeholder rule below.
 */
const DEFAULT_PASSWORDS = new Set([
  'postgres',
  'password',
  'passw0rd',
  'secret',
  'admin',
  'root',
  'example',
  'test',
  'default',
  'supabase',
]);

/**
 * Whether a value is too generic to search for: it would flag ordinary text (`postgres`,
 * `password`, `proxy-managed`) or is an obvious placeholder (`<password>`, `****`, `changeme`,
 * `${VAR}`, one repeated character).
 *
 * A lowercase word under {@link MIN_WORD_LENGTH} is trivial for a generated value (token, key) but
 * not for a `password`, which a person picks (`correcthorsebat`): there only the well-known defaults
 * in {@link DEFAULT_PASSWORDS} are dropped.
 */
export function isTrivialValue(value: string, password = false): boolean {
  if (value.length < MIN_LENGTH) return true;
  if (password) {
    if (DEFAULT_PASSWORDS.has(value.toLowerCase())) return true;
  } else if (/^[a-z][a-z._-]*$/.test(value) && value.length < MIN_WORD_LENGTH) return true;
  return (
    /^<.*>$/s.test(value) ||
    /^\*+$/.test(value) ||
    /^change-?me$/i.test(value) ||
    /^\$\{?\w+\}?$/.test(value) ||
    /^(.)\1+$/s.test(value)
  );
}

/** Where the closing `quote` of a value that opened at `from` is, or -1. `"` honours `\` escapes. */
function closingQuote(text: string, from: number, quote: string): number {
  for (let i = from; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') i++;
    else if (text[i] === quote) return i;
  }
  return -1;
}

/** `NAME=value` assignments, in file order; a key assigned twice appears twice. */
type Assignments = [name: string, value: string][];

/** A variable name, as opposed to a stray `=` in prose or base64 padding. */
const VARIABLE_NAME = /^[A-Za-z_][\w.-]*$/;

/**
 * Parse a dotenv file the way `dotenv` does: `export`, `#` comments (a whole line, or ` #…` after an
 * unquoted value or a closing quote), one layer of quotes — a quoted value may span lines — CRLF. A
 * quote that never closes is read as an ordinary value. Unlike `dotenv`, EVERY assignment of a key
 * is returned, not the last: a detector must know each value that is or was a credential.
 *
 * Also returns the offsets of the lines that opened a quote which did close, so the line pass in
 * {@link parseEnvLines} leaves those alone.
 */
function parseEnvQuoted(text: string): { values: Assignments; closed: Set<number> } {
  const values: Assignments = [];
  const closed = new Set<number>();
  let pos = 0;
  while (pos < text.length) {
    const lineStart = pos;
    const lineEnd = text.includes('\n', pos) ? text.indexOf('\n', pos) : text.length;
    const raw = text.slice(lineStart, lineEnd);
    const lead = /^\s*(export\s+)?/.exec(raw)?.[0].length ?? 0;
    const line = raw.slice(lead);
    pos = lineEnd + 1;
    const eq = line.indexOf('=');
    if (line.startsWith('#') || eq === -1) continue;
    const name = line.slice(0, eq).trim();
    const rest = line.slice(eq + 1).trimStart();
    const quote = rest[0];
    if (quote !== undefined && '"\'`'.includes(quote)) {
      // Search from just after the opening quote, across lines, for the closing one.
      const skipped = line.length - eq - 1 - rest.length;
      const valueStart = lineStart + lead + eq + 1 + skipped + 1;
      const close = closingQuote(text, valueStart, quote);
      if (close !== -1) {
        values.push([name, text.slice(valueStart, close)]);
        closed.add(lineStart);
        const after = text.indexOf('\n', close);
        pos = after === -1 ? text.length : after + 1;
        continue;
      }
    }
    values.push([name, rest.replace(/\s+#.*$/s, '').trimEnd()]);
  }
  return { values, closed };
}

/**
 * A naive pass over every line on its own, so a quote left open on one line cannot swallow the
 * assignments after it (the quoted parse would read on to the next quote, wherever it is). A value
 * is read without its quotes; one whose quote never closes on the line is also read without it, and
 * an unquoted one without a stray trailing quote. Lines in `closed` are skipped: the quoted parse
 * already took their (multi-line) value whole.
 */
function parseEnvLines(text: string, closed: ReadonlySet<number>): Assignments {
  const values: Assignments = [];
  let lineStart = 0;
  for (const raw of text.split('\n')) {
    const start = lineStart;
    lineStart += raw.length + 1;
    const line = raw.replace(/^\s*(export\s+)?/, '');
    const eq = line.indexOf('=');
    if (line.startsWith('#') || eq === -1 || closed.has(start)) continue;
    const name = line.slice(0, eq).trim();
    if (!VARIABLE_NAME.test(name)) continue;
    const rest = line.slice(eq + 1).trimStart();
    const quote = rest[0];
    if (quote !== undefined && '"\'`'.includes(quote)) {
      const end = rest.indexOf(quote, 1);
      values.push([name, end === -1 ? rest.slice(1).trimEnd() : rest.slice(1, end)]);
      continue;
    }
    const value = rest.replace(/\s+#.*$/s, '').trimEnd();
    values.push([name, value], [name, value.replace(/["'`]+$/, '')]);
  }
  return values;
}

/** Every assignment in a dotenv file: the quote-aware parse plus the line-by-line one. */
function parseEnvFile(content: string): Assignments {
  const text = content.replaceAll('\r\n', '\n');
  const { values, closed } = parseEnvQuoted(text);
  return [...values, ...parseEnvLines(text, closed)];
}

/** Variables a git hook exports that would point `git` at the hook's repo instead of `cwd`. */
const REPO_LOCATING_GIT_VARS = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
]);

/** `git` run in `cwd`, with {@link REPO_LOCATING_GIT_VARS} removed. */
function gitOutput(cwd: string, args: readonly string[]): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !REPO_LOCATING_GIT_VARS.has(name)),
  );
  return execFileSync('git', [...args], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
}

const realPath = (dir: string): string => {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
};

/**
 * The roots whose gitignored dotenv files hold this checkout's live credentials: the checkout that
 * contains `startDir` and the main worktree. Gitignored files exist only in the main checkout, so a
 * linked worktree (`.claude/worktrees/<name>`) that read only itself would see no secret at all.
 * Outside a git repo (or without git) it is `startDir` alone.
 */
export function repoEnvRoots(startDir: string): string[] {
  try {
    const top = gitOutput(startDir, ['rev-parse', '--show-toplevel']);
    const common = gitOutput(startDir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    const roots = [realPath(top)];
    if (path.basename(common) === '.git') roots.push(realPath(path.dirname(common)));
    return [...new Set(roots)];
  } catch {
    return [path.resolve(startDir)];
  }
}

/** Dotenv-style files: `.env`, `.env.local`, `.dev.vars`, … but not the committed templates. */
function isEnvFileName(file: string): boolean {
  const name = path.posix.basename(file);
  return (
    (name.startsWith('.env') || name.startsWith('.dev.vars')) &&
    !/\.(example|sample|template)$/i.test(name)
  );
}

/** Where the dotenv files live when git cannot say: the root and the package directories. */
const PACKAGE_DIRS = ['', 'frontend', 'workers', 'database'];

/**
 * The gitignored dotenv-style files (repo-relative, `/`-separated) under `root`: everything git
 * ignores and does not track whose name is `.env*` or `.dev.vars*`, outside `node_modules`. Without
 * git, the same names in the root and its package directories.
 */
function envFilesIn(root: string): string[] {
  try {
    return gitOutput(root, [
      'ls-files',
      '-z',
      '-o',
      '-i',
      '--exclude-standard',
      '--',
      ':(glob)**/.env*',
      ':(glob)**/.dev.vars*',
      // A dependency's own .env holds its fixtures, not our credentials.
      ':(exclude,glob)**/node_modules/**',
    ])
      .split('\0')
      .filter((file) => file !== '' && isEnvFileName(file));
  } catch {
    return PACKAGE_DIRS.flatMap((dir) => {
      try {
        return readdirSync(path.join(root, dir))
          .filter((name) => isEnvFileName(name) && statSync(path.join(root, dir, name)).isFile())
          .map((name) => (dir === '' ? name : `${dir}/${name}`));
      } catch {
        return [];
      }
    });
  }
}

function readEnvFile(root: string, relative: string): Assignments {
  try {
    return parseEnvFile(readFileSync(path.join(root, relative), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    // The message only names the file and the errno — never file content.
    throw new Error(`cannot read ${relative}: ${(error as NodeJS.ErrnoException).code ?? 'error'}`);
  }
}

function decodeQuietly(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The passwords a URL-shaped value carries, raw and percent-decoded: the userinfo password (as the
 * WHATWG URL parser splits it, and greedily up to the last `@` so an unencoded `@` or `/` in it is
 * still caught) and any `password`-like query parameter. Empty for anything else.
 *
 * The greedy match is only trusted when the WHATWG parse also finds a password, or cannot parse the
 * value at all: `https://h:443/x?u=a@b` has no userinfo, and greedily "the password" would be
 * `443/x?u=a`.
 */
function urlPasswords(value: string): string[] {
  if (!URL_SHAPED.test(value)) return [];
  const found: string[] = [];
  const greedy = URL_WITH_PASSWORD.exec(value)?.[1];
  try {
    const url = new URL(value);
    if (url.password !== '') found.push(url.password);
    if (greedy !== undefined && url.password !== '') found.push(greedy);
    for (const [key, param] of url.searchParams) {
      if (PASSWORD_PARAM.test(key.toLowerCase()) && param !== '') found.push(param);
    }
  } catch {
    // Not parseable as a URL; the greedy match is all there is.
    if (greedy !== undefined) found.push(greedy);
  }
  return [...new Set(found.flatMap((password) => [password, decodeQuietly(password)]))];
}

/** Add the secret(s) one variable holds; `where` is `$NAME` for the environment, else `NAME in <file>`. */
function collect(found: Map<string, string>, name: string, value: string, where: string): void {
  if (/^NEXT_PUBLIC_/i.test(name)) return;
  const add = (secret: string, source: string, password = false): void => {
    if (!isTrivialValue(secret, password) && !found.has(secret)) found.set(secret, source);
  };
  if (URL_SHAPED.test(value)) {
    // Whatever the variable is called, a URL is only secret if its password is;
    // `postgres://postgres:postgres@localhost` is a fixture.
    const passwords = urlPasswords(value).filter((password) => !isTrivialValue(password, true));
    if (passwords.length === 0) return;
    add(value, `the value of ${where}`);
    for (const password of passwords) add(password, `the password from ${where}`, true);
    return;
  }
  if (URL_NAME.test(name) || !SECRET_NAME.test(name) || NOT_A_SECRET_NAME.test(name)) return;
  if (PATH_OR_FLAG_VALUE.test(value)) return;
  add(value, `the value of ${where}`, PASSWORD_NAME.test(name));
}

/**
 * The live secrets this process can see: credential-named variables in the environment and in the
 * gitignored dotenv files of `envRoots` (if any), and the password of every connection-string URL
 * among them. A dotenv file contributes every assignment of every key, not only the last. Trivial
 * values are dropped (see {@link isTrivialValue}). Each distinct value appears once.
 */
export function knownSecrets(options: KnownSecretsOptions = {}): KnownSecret[] {
  const found = new Map<string, string>();
  for (const [name, value] of Object.entries(options.env ?? process.env)) {
    if (value !== undefined) collect(found, name, value.trim(), `$${name}`);
  }
  for (const root of options.envRoots ?? []) {
    for (const file of envFilesIn(root)) {
      for (const [name, value] of readEnvFile(root, file)) {
        collect(found, name, value, `${name} in ${file}`);
      }
    }
  }
  return [...found].map(([value, source]) => ({ value, source }));
}

/**
 * The base64 / base64url spellings of `value` that survive being embedded at any offset in a larger
 * blob (`Authorization: Basic base64(user:value)`). Base64 encodes 3 bytes at a time, so the value
 * lands on one of three alignments; for the two shifted ones, encode a filler prefix and drop the
 * leading characters it influences. The ragged tail (the last, partial character, and any `=`
 * padding) depends on whatever follows the value, so it is dropped too.
 */
function base64Forms(value: string): string[] {
  const forms: string[] = [];
  // [prefix bytes, leading characters that depend on the prefix]
  for (const [prefix, lead] of [
    [0, 0],
    [1, 2],
    [2, 3],
  ] as const) {
    const bytes = Buffer.concat([Buffer.alloc(prefix, 'x'), Buffer.from(value, 'utf8')]);
    const end = Math.floor((bytes.length * 8) / 6);
    forms.push(
      bytes.toString('base64').slice(lead, end),
      bytes.toString('base64url').slice(lead, end),
    );
  }
  return forms;
}

/**
 * The spellings a value takes in output: raw, percent-encoded (a URL), JSON-escaped, and base64 /
 * base64url at every alignment (see {@link base64Forms}), padded or not.
 */
function variants(value: string): string[] {
  return [
    ...new Set([
      value,
      encodeURIComponent(value),
      JSON.stringify(value).slice(1, -1),
      ...base64Forms(value),
    ]),
  ];
}

/**
 * The sources of every known secret `content` contains, each once. Text is also searched with NULs
 * removed and with line breaks removed too, so UTF-16 output (`p\0a\0s\0s`, or the same after the
 * scanner turned each NUL into a newline) cannot hide a value.
 */
export function findKnownSecrets(content: string, secrets: readonly KnownSecret[]): string[] {
  if (secrets.length === 0) return [];
  const haystacks = [content, content.replaceAll('\0', ''), content.replaceAll(/[\0\r\n]/g, '')];
  const sources = new Set<string>();
  for (const { value, source } of secrets) {
    if (variants(value).some((form) => haystacks.some((text) => text.includes(form)))) {
      sources.add(source);
    }
  }
  return [...sources];
}

/** A masked, human-readable report for `label`, or `undefined` when `content` holds no known secret. */
export function knownSecretsReport(
  content: string,
  label: string,
  secrets: readonly KnownSecret[],
): string | undefined {
  const sources = findKnownSecrets(content, secrets);
  if (sources.length === 0) return undefined;
  return [label, ...sources.map((source) => `  contains ${source}`)].join('\n');
}
