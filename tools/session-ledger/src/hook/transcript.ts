import type { JsonObject } from '../types.ts';

/**
 * Reading a Claude Code transcript (a JSONL file). The format is a CLI internal, so every read
 * is defensive: an entry or field of an unexpected shape is skipped, never thrown on.
 */

/** Usage of one model over the requests one transcript made with it. */
export interface ModelUsage {
  requests: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
  web_search: number;
}

export type UsageByModel = Record<string, ModelUsage>;

/** Claude Code writes entries for local errors under this placeholder model, with no real usage. */
const SYNTHETIC_MODEL = '<synthetic>';

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Every parseable line; a line that doesn't parse (the file may be mid-write) is skipped. */
export function parseJsonl(text: string): JsonObject[] {
  const entries: JsonObject[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (isObject(entry)) entries.push(entry);
    } catch {
      // A partially written line: the next turn's recount reads it whole.
    }
  }
  return entries;
}

function emptyUsage(): ModelUsage {
  return {
    requests: 0,
    input: 0,
    output: 0,
    cache_read: 0,
    cache_write_5m: 0,
    cache_write_1h: 0,
    web_search: 0,
  };
}

/** The 5-minute and 1-hour cache writes: split when the transcript says how, else all 5-minute. */
function cacheWrites(usage: JsonObject): { m5: number; h1: number } {
  const split = usage['cache_creation'];
  if (
    isObject(split) &&
    (typeof split['ephemeral_5m_input_tokens'] === 'number' ||
      typeof split['ephemeral_1h_input_tokens'] === 'number')
  ) {
    return {
      m5: count(split['ephemeral_5m_input_tokens']),
      h1: count(split['ephemeral_1h_input_tokens']),
    };
  }
  return { m5: count(usage['cache_creation_input_tokens']), h1: 0 };
}

function webSearches(usage: JsonObject): number {
  const tools = usage['server_tool_use'];
  return isObject(tools) ? count(tools['web_search_requests']) : 0;
}

/**
 * Usage per model. One API response is written as several entries (one per content block), each
 * repeating the response's usage, so only the last entry seen for each message id counts. Fast-mode
 * usage (`usage.speed: "fast"`) is kept apart as `<model>/fast`: it is billed at other rates than
 * the price table's, so it must stay unpriced rather than be priced as standard.
 */
export function usageByModel(entries: readonly JsonObject[]): UsageByModel {
  const latest = new Map<string, { model: string; usage: JsonObject }>();
  for (const [index, entry] of entries.entries()) {
    const message = entry['type'] === 'assistant' ? entry['message'] : undefined;
    if (!isObject(message)) continue;
    const model = message['model'];
    const usage = message['usage'];
    if (typeof model !== 'string' || model === SYNTHETIC_MODEL || !isObject(usage)) continue;
    const id = message['id'];
    const requestId = entry['requestId'];
    let key = `line:${String(index)}`;
    if (typeof id === 'string') key = id;
    else if (typeof requestId === 'string') key = requestId;
    latest.set(key, { model: usage['speed'] === 'fast' ? `${model}/fast` : model, usage });
  }
  const byModel: UsageByModel = {};
  for (const { model, usage } of latest.values()) {
    const total = (byModel[model] ??= emptyUsage());
    const writes = cacheWrites(usage);
    total.requests += 1;
    total.input += count(usage['input_tokens']);
    total.output += count(usage['output_tokens']);
    total.cache_read += count(usage['cache_read_input_tokens']);
    total.cache_write_5m += writes.m5;
    total.cache_write_1h += writes.h1;
    total.web_search += webSearches(usage);
  }
  return byModel;
}

/**
 * Whether some response in the transcript never reached a final entry (one with a `stop_reason`).
 * Subagent transcripts often keep only a response's streaming-start entry, whose usage holds a
 * placeholder output count, so their tokens are a fraction of what was billed and can't be priced.
 */
export function hasPartialUsage(entries: readonly JsonObject[]): boolean {
  const complete = new Map<string, boolean>();
  for (const entry of entries) {
    const message = entry['type'] === 'assistant' ? entry['message'] : undefined;
    if (!isObject(message) || message['model'] === SYNTHETIC_MODEL) continue;
    const id = message['id'];
    if (typeof id !== 'string') continue;
    const final = typeof message['stop_reason'] === 'string';
    complete.set(id, (complete.get(id) ?? false) || final);
  }
  return [...complete.values()].some((done) => !done);
}

/** Two per-model tallies added together, model by model. */
export function mergeUsage(a: UsageByModel, b: UsageByModel): UsageByModel {
  const merged: UsageByModel = {};
  for (const source of [a, b]) {
    for (const [model, usage] of Object.entries(source)) {
      const total = (merged[model] ??= emptyUsage());
      total.requests += usage.requests;
      total.input += usage.input;
      total.output += usage.output;
      total.cache_read += usage.cache_read;
      total.cache_write_5m += usage.cache_write_5m;
      total.cache_write_1h += usage.cache_write_1h;
      total.web_search += usage.web_search;
    }
  }
  return merged;
}

export interface TokenTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

/** The session-wide token columns over any number of per-model tallies. */
export function tokenTotals(...tallies: readonly UsageByModel[]): TokenTotals {
  const totals: TokenTotals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
  for (const tally of tallies) {
    for (const usage of Object.values(tally)) {
      totals.input_tokens += usage.input;
      totals.output_tokens += usage.output;
      totals.cache_read_tokens += usage.cache_read;
      totals.cache_write_tokens += usage.cache_write_5m + usage.cache_write_1h;
    }
  }
  return totals;
}

function mainThread(entries: readonly JsonObject[]): JsonObject[] {
  return entries.filter((entry) => entry['isSidechain'] !== true);
}

function stringField(entry: JsonObject, key: string): string | null {
  const value = entry[key];
  return typeof value === 'string' ? value : null;
}

/**
 * The launch prompt: the text of the first main-thread user entry that is not meta and not a tool
 * result. Content is either a string or a list of blocks, whose text blocks join with a newline.
 */
export function promptOf(entries: readonly JsonObject[]): string | null {
  for (const entry of mainThread(entries)) {
    if (entry['type'] !== 'user' || entry['isMeta'] === true) continue;
    const message = entry['message'];
    const content = isObject(message) ? message['content'] : undefined;
    if (typeof content === 'string') {
      if (content !== '') return content;
      continue;
    }
    if (!Array.isArray(content)) continue;
    const blocks = content.filter((block): block is JsonObject => isObject(block));
    if (blocks.some((block) => block['type'] === 'tool_result')) continue;
    const texts = blocks
      .filter((block) => block['type'] === 'text')
      .map((block) => stringField(block, 'text'))
      .filter((text) => text !== null);
    if (texts.length > 0) return texts.join('\n');
  }
  return null;
}

export interface MainFacts {
  /** The first main-thread assistant model. */
  model: string | null;
  /** The last one — what was serving the session when it was read. */
  servedModel: string | null;
  /** The last `effort` any main-thread entry carried. */
  effort: string | null;
  /** The first timestamp in the transcript. */
  createdAt: string | null;
  prompt: string | null;
}

export function mainFacts(entries: readonly JsonObject[]): MainFacts {
  const main = mainThread(entries);
  let model: string | null = null;
  let servedModel: string | null = null;
  let effort: string | null = null;
  for (const entry of main) {
    const message = entry['message'];
    const entryModel =
      entry['type'] === 'assistant' && isObject(message) ? stringField(message, 'model') : null;
    if (entryModel !== null && entryModel !== SYNTHETIC_MODEL) {
      model ??= entryModel;
      servedModel = entryModel;
    }
    effort = stringField(entry, 'effort') ?? effort;
  }
  const createdAt = entries.map((entry) => stringField(entry, 'timestamp')).find((t) => t !== null);
  return { model, servedModel, effort, createdAt: createdAt ?? null, prompt: promptOf(entries) };
}
