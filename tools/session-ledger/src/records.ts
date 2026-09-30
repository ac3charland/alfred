import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { byString, sortedBy } from './sort.ts';
import type { JsonObject, LedgerRow } from './types.ts';

/**
 * Session records: the `get_session` JSON the session-ledger skill's subagents copy, one object
 * per line, into `<scratch>/ledger/sessions/<batch>.ndjson`. A script can't call the session MCP,
 * so these files are this tool's only view of a session. The record is copied by a model, so
 * every line is validated before use.
 */

const SESSION_ID_RE = /^session_[A-Za-z0-9]+$/;
const USAGE_KEYS = [
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'cost_usd',
] as const;

export type ParsedLine =
  | { kind: 'record'; record: JsonObject }
  | { kind: 'unavailable'; id: string }
  | { kind: 'invalid'; id: string | undefined; reason: string };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(value: JsonObject, key: string): JsonObject {
  const child = value[key];
  return isObject(child) ? child : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Why a candidate record can't be trusted, or `undefined` when it can. */
function invalidReason(candidate: JsonObject): string | undefined {
  const createdAt = candidate['created_at'];
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
    return 'created_at is not a timestamp';
  }
  if (!isObject(candidate['session_context'])) return 'session_context is not an object';
  const usage = objectAt(objectAt(candidate, 'external_metadata'), 'usage');
  const badKey = USAGE_KEYS.find((key) => key in usage && typeof usage[key] !== 'number');
  if (badKey !== undefined) return `usage.${badKey} is not a number`;
  return undefined;
}

/**
 * One NDJSON line: a record (bare, or wrapped in the MCP tool's `{"ccr": …}` envelope), a
 * subagent's `{"id": …, "unavailable": …}` marker for a record it couldn't fetch, or invalid.
 */
export function parseRecordLine(line: string): ParsedLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: 'invalid', id: undefined, reason: 'not JSON' };
  }
  if (!isObject(parsed)) return { kind: 'invalid', id: undefined, reason: 'not a JSON object' };

  const candidate = isObject(parsed['ccr']) ? parsed['ccr'] : parsed;
  const id = candidate['id'];
  if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) {
    return { kind: 'invalid', id: undefined, reason: 'id is not a session id' };
  }
  if ('unavailable' in candidate) return { kind: 'unavailable', id };

  const reason = invalidReason(candidate);
  return reason === undefined
    ? { kind: 'record', record: candidate }
    : { kind: 'invalid', id, reason };
}

export interface InvalidLine {
  file: string;
  line: number;
  id: string | undefined;
  reason: string;
}

export interface SessionDir {
  records: JsonObject[];
  unavailable: string[];
  invalid: InvalidLine[];
}

/** Every `.ndjson` file in `dir`, in name order. A session fetched twice keeps its first copy. */
export function readSessionDir(dir: string): SessionDir {
  const records: JsonObject[] = [];
  const unavailable: string[] = [];
  const invalid: InvalidLine[] = [];
  const seen = new Set<string>();

  const files = sortedBy(
    readdirSync(dir).filter((name) => name.endsWith('.ndjson')),
    byString,
  );
  for (const file of files) {
    const lines = readFileSync(path.join(dir, file), 'utf8').split('\n');
    for (const [index, text] of lines.entries()) {
      if (text.trim() === '') continue;
      const parsed = parseRecordLine(text);
      if (parsed.kind === 'invalid') {
        invalid.push({ file, line: index + 1, id: parsed.id, reason: parsed.reason });
        continue;
      }
      const id = parsed.kind === 'record' ? String(parsed.record['id']) : parsed.id;
      if (seen.has(id)) continue;
      seen.add(id);
      if (parsed.kind === 'record') records.push(parsed.record);
      else unavailable.push(id);
    }
  }
  return { records, unavailable, invalid };
}

function sourcesOf(record: JsonObject): unknown {
  return objectAt(record, 'session_context')['sources'] ?? [];
}

/** Does any of the session's sources point at `github.com/<repo>` (exactly that repo)? */
export function touchesRepo(record: JsonObject, repo: string): boolean {
  const escaped = repo.replaceAll(/[.*+?^${}()|[\]\\/]/g, String.raw`\$&`);
  const pattern = new RegExp(String.raw`github\.com\/${escaped}(?:\.git)?(?![\w.-])`, 'i');
  return pattern.test(JSON.stringify(sourcesOf(record)));
}

export type SessionFields = Pick<
  LedgerRow,
  | 'title'
  | 'session_created_at'
  | 'status'
  | 'configured_model'
  | 'model'
  | 'served_model'
  | 'effort_level'
  | 'cost_usd'
  | 'input_tokens'
  | 'output_tokens'
  | 'cache_read_tokens'
  | 'cache_write_tokens'
>;

/** The ledger's session columns, read straight off the record. */
export function sessionFields(record: JsonObject): SessionFields {
  const context = objectAt(record, 'session_context');
  const metadata = objectAt(record, 'external_metadata');
  const usage = objectAt(metadata, 'usage');
  return {
    title: stringOrNull(record['title']),
    session_created_at: stringOrNull(record['created_at']),
    status: stringOrNull(record['status_bucket']),
    configured_model: stringOrNull(record['configured_model']),
    model: stringOrNull(context['model']),
    served_model: stringOrNull(metadata['last_served_model']),
    effort_level: stringOrNull(context['effort_level']),
    cost_usd: numberOrNull(usage['cost_usd']),
    input_tokens: numberOrNull(usage['input_tokens']),
    output_tokens: numberOrNull(usage['output_tokens']),
    cache_read_tokens: numberOrNull(usage['cache_read_tokens']),
    cache_write_tokens: numberOrNull(usage['cache_write_tokens']),
  };
}

/**
 * The fields the ledger derives from, as `verify` compares them between a subagent's copy and
 * the lead's own re-fetch: the model fields, effort, usage, created_at and sources.
 */
export function verifiedFields(record: JsonObject): JsonObject {
  const context = objectAt(record, 'session_context');
  const metadata = objectAt(record, 'external_metadata');
  return {
    created_at: record['created_at'],
    configured_model: record['configured_model'],
    model: context['model'],
    served_model: metadata['last_served_model'],
    effort_level: context['effort_level'],
    usage: metadata['usage'],
    sources: context['sources'],
  };
}
