import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { SourceKey } from './contract.ts';

/**
 * The daemon's configuration: a JSON file the owner edits by hand, validated by hand so every
 * failure names the file, the field, and what was expected. There is no secret in it — those live
 * in the keychain (see `keychain.ts`).
 */

/** The directory the config and the cursor cache share, under the owner's home. */
export const APP_SUPPORT_SUBPATH = ['Library', 'Application Support', 'alfred-daemon'] as const;

/** Overrides the whole app-support location, config and state together. Used by tests and by hand. */
export const CONFIG_PATH_ENV = 'ALFRED_DAEMON_CONFIG';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export interface IMessageSourceConfig {
  enabled: boolean;
  label: string;
}

export interface WorkmailSourceConfig {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  label: string;
}

export interface DaemonConfig {
  /** The ingest endpoint every payload is POSTed to. */
  ingestUrl: string;
  /** A source absent from the file is simply not run. */
  sources: {
    imessage?: IMessageSourceConfig;
    workmail?: WorkmailSourceConfig;
  };
}

const KNOWN_SOURCES: ReadonlySet<SourceKey> = new Set(['imessage', 'workmail']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function requireString(
  source: Record<string, unknown>,
  key: string,
  label: string,
  path: string,
): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(`${path}: "${label}" is required and must be a string`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ConfigError(`${path}: "${label}" must be true or false`);
  }
  return value;
}

function parseIMessage(raw: unknown, path: string): IMessageSourceConfig {
  if (!isRecord(raw)) {
    throw new ConfigError(`${path}: "sources.imessage" must be an object`);
  }
  const label = raw['label'] ?? 'iMessage';
  if (typeof label !== 'string' || label.length === 0) {
    throw new ConfigError(`${path}: "sources.imessage.label" must be a string`);
  }
  return {
    enabled: requireBoolean(raw['enabled'], 'sources.imessage.enabled', path),
    label,
  };
}

function parseWorkmail(raw: unknown, path: string): WorkmailSourceConfig {
  if (!isRecord(raw)) {
    throw new ConfigError(`${path}: "sources.workmail" must be an object`);
  }
  // The connection details are demanded whenever the source is configured, enabled or not: a
  // half-written mailbox that is switched on months later should fail now, while it is being read.
  const enabled = requireBoolean(raw['enabled'], 'sources.workmail.enabled', path);
  const host = requireString(raw, 'host', 'sources.workmail.host', path);
  const port = raw['port'];
  if (typeof port !== 'number' || !Number.isInteger(port)) {
    throw new ConfigError(`${path}: "sources.workmail.port" must be an integer`);
  }
  return {
    enabled,
    host,
    port,
    user: requireString(raw, 'user', 'sources.workmail.user', path),
    label: requireString(raw, 'label', 'sources.workmail.label', path),
  };
}

export function parseConfig(raw: string, path: string): DaemonConfig {
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`${path}: not valid JSON — ${detail}`);
  }

  if (!isRecord(document)) {
    throw new ConfigError(`${path}: expected a JSON object`);
  }

  const ingestUrl = document['ingestUrl'];
  if (!isHttpUrl(ingestUrl)) {
    throw new ConfigError(`${path}: "ingestUrl" is required and must be an http(s) URL`);
  }

  const rawSources = document['sources'];
  if (!isRecord(rawSources)) {
    throw new ConfigError(`${path}: "sources" is required and must be an object`);
  }

  for (const key of Object.keys(rawSources)) {
    if (!KNOWN_SOURCES.has(key as SourceKey)) {
      throw new ConfigError(
        `${path}: unknown source "${key}" — the daemon polls "imessage" and "workmail"`,
      );
    }
  }

  const sources: DaemonConfig['sources'] = {};
  if (rawSources['imessage'] !== undefined) {
    sources.imessage = parseIMessage(rawSources['imessage'], path);
  }
  if (rawSources['workmail'] !== undefined) {
    sources.workmail = parseWorkmail(rawSources['workmail'], path);
  }

  return { ingestUrl, sources };
}

/** The config file's location: the env override if set, else the app-support directory. */
export function configPathFrom(env: Record<string, string | undefined>, home: string): string {
  return env[CONFIG_PATH_ENV] ?? path.join(home, ...APP_SUPPORT_SUBPATH, 'config.json');
}

/** The cursor cache sits beside the config, so one override moves both. */
export function stateFilePathFor(configPath: string): string {
  return path.join(path.dirname(configPath), 'state.json');
}

export function loadConfig(path: string, read: (p: string) => string = defaultRead): DaemonConfig {
  let raw: string;
  try {
    raw = read(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`${path}: cannot be read — ${detail}`);
  }
  return parseConfig(raw, path);
}

function defaultRead(path: string): string {
  return readFileSync(path, 'utf8');
}
