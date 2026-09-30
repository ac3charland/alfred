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
import { readFileSync } from 'node:fs';
import process from 'node:process';

/** The gitignored file that holds the developer's live credentials, relative to the repo root. */
export const ENV_LOCAL_RELATIVE = 'frontend/.env.local';

/** A live secret value and how to name where it came from (never the value itself). */
export interface KnownSecret {
  value: string;
  /** e.g. `the value of $PGPASSWORD`, `the password from DATABASE_URL in frontend/.env.local`. */
  source: string;
}

export interface KnownSecretsOptions {
  /** Environment to read; defaults to this process's. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Absolute path of a dotenv file to read too (normally `<repo>/frontend/.env.local`). */
  envFile?: string;
}

/** Names that hold a credential. */
const SECRET_NAME = /PASS|SECRET|TOKEN|KEY|PWD/i;
/** Connection-string variables: their password (and the whole URL) is the secret. */
const URL_NAME = /^(DATABASE_URL|SUPABASE_DB_URL)$|(_URL|_URI|_DSN)$/i;
/** Names that match {@link SECRET_NAME} but hold a location or a config name, never a secret. */
const NOT_A_SECRET_NAME = /^(PWD|OLDPWD)$|_(FILE|PATH|DIR|HOME)$|^GIT_CONFIG_/i;
/** `scheme://user:password@host…` — the password is everything up to the last `@`. */
const URL_WITH_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^:/@\s]*:(.+)@[^@]*$/is;
const URL_SHAPED = /^[a-z][a-z0-9+.-]*:\/\//i;

const MIN_LENGTH = 8;
/** A lowercase word (letters and `._-`) shorter than this is a word, not a generated secret. */
const MIN_WORD_LENGTH = 16;

/**
 * Whether a value is too generic to search for: it would flag ordinary text (`postgres`,
 * `password`, `proxy-managed`) or is an obvious placeholder (`<password>`, `****`, `changeme`,
 * `${VAR}`, one repeated character).
 */
export function isTrivialValue(value: string): boolean {
  if (value.length < MIN_LENGTH) return true;
  if (/^[a-z][a-z._-]*$/.test(value) && value.length < MIN_WORD_LENGTH) return true;
  return (
    /^<.*>$/s.test(value) ||
    /^\*+$/.test(value) ||
    /^change-?me$/i.test(value) ||
    /^\$\{?\w+\}?$/.test(value) ||
    /^(.)\1+$/s.test(value)
  );
}

/** Parse dotenv lines the way `database/src/migrate.ts` does: `export`, `#` comments, one layer of quotes. */
function parseEnvFile(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const raw of content.split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
    if (!values.has(line.slice(0, eq).trim())) values.set(line.slice(0, eq).trim(), value);
  }
  return values;
}

function readEnvFile(file: string): Map<string, string> {
  try {
    return parseEnvFile(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    // The message only names the path and the errno — never file content.
    throw new Error(
      `cannot read ${ENV_LOCAL_RELATIVE}: ${(error as NodeJS.ErrnoException).code ?? 'error'}`,
    );
  }
}

function decodeQuietly(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Add the secret(s) one variable holds; `where` is `$NAME` for the environment, else `NAME in <file>`. */
function collect(found: Map<string, string>, name: string, value: string, where: string): void {
  const urlName = URL_NAME.test(name);
  if (!urlName && !SECRET_NAME.test(name)) return;
  if (NOT_A_SECRET_NAME.test(name)) return;
  const add = (secret: string, source: string): void => {
    if (!isTrivialValue(secret) && !found.has(secret)) found.set(secret, source);
  };
  const password = URL_WITH_PASSWORD.exec(value)?.[1];
  if (password !== undefined) {
    // A URL is only secret if its password is; `postgres://postgres:postgres@localhost` is a fixture.
    if (isTrivialValue(decodeQuietly(password)) && isTrivialValue(password)) return;
    add(value, `the value of ${where}`);
    add(password, `the password from ${where}`);
    add(decodeQuietly(password), `the password from ${where}`);
  } else if (!urlName && !URL_SHAPED.test(value)) {
    add(value, `the value of ${where}`);
  }
}

/**
 * The live secrets this process can see: credential-named variables in the environment and in the
 * dotenv file (if any), and the password of every connection-string URL among them. Trivial values
 * are dropped (see {@link isTrivialValue}). Each distinct value appears once.
 */
export function knownSecrets(options: KnownSecretsOptions = {}): KnownSecret[] {
  const found = new Map<string, string>();
  for (const [name, value] of Object.entries(options.env ?? process.env)) {
    if (value !== undefined) collect(found, name, value.trim(), `$${name}`);
  }
  if (options.envFile !== undefined) {
    for (const [name, value] of readEnvFile(options.envFile)) {
      collect(found, name, value, `${name} in ${ENV_LOCAL_RELATIVE}`);
    }
  }
  return [...found].map(([value, source]) => ({ value, source }));
}

/**
 * The spellings a value takes in output: raw, percent-encoded (a URL), JSON-escaped, and base64 /
 * base64url (unpadded, so padded and unpadded forms both match). Base64 inside a larger blob only
 * matches when the value starts on a 3-byte boundary — a known blind spot.
 */
function variants(value: string): string[] {
  const bytes = Buffer.from(value, 'utf8');
  return [
    ...new Set([
      value,
      encodeURIComponent(value),
      JSON.stringify(value).slice(1, -1),
      bytes.toString('base64').replace(/=+$/, ''),
      bytes.toString('base64url'),
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
