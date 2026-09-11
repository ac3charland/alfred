import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A local cursor cache, so a restart resumes without waiting for the server to answer. It is a
 * CACHE and nothing more: the ingest endpoint's cursor wins whenever it has one, and a file that
 * is missing or corrupt just means the daemon resumes from the server's answer instead. Never let
 * it be a reason to crash.
 *
 * Written temp-then-rename so a crash mid-write leaves the previous state intact rather than a
 * truncated file the next start would have to interpret.
 */

export interface SourceState {
  cursor?: unknown;
  /**
   * Admits `null` even though this process only ever writes a string here (see `runner.ts`): the
   * ingest endpoint's own `last_seen_at` admits a real JSON `null` (`contract.ts`), and this cache
   * is read back with no schema validation beyond "is it an object" (`readState` below). Typing it
   * `string` only would just move the lie here instead of fixing it — a hand-edited or
   * differently-versioned state.json can carry `null`, and the type should say so rather than let
   * a caller assume a string it never checked for.
   */
  lastSeenAt?: string | null;
}

export type DaemonState = Record<string, SourceState>;

export function readState(file: string): DaemonState {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as DaemonState;
  } catch {
    return {};
  }
}

export function writeState(file: string, state: DaemonState): void {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.state.${String(process.pid)}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(state, undefined, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}
