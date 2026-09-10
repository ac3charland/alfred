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
  lastSeenAt?: string;
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
