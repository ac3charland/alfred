import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The hook's scratch space, `<tmp>/alfred-session-ledger/`: one state file per session, written
 * at session start and read at the first prompt and every stop; a marker per session once its first
 * prompt is claimed; and the log of failed writes.
 */

/** What session start observed, which the session itself will have changed by its first stop. */
export interface StartState {
  repo: string;
  base_sha: string;
  builder_sha: string | null;
}

function scratchDir(tmpDir: string): string {
  return path.join(tmpDir, 'alfred-session-ledger');
}

export function writeState(tmpDir: string, sessionId: string, state: StartState): void {
  mkdirSync(scratchDir(tmpDir), { recursive: true });
  writeFileSync(path.join(scratchDir(tmpDir), `${sessionId}.json`), JSON.stringify(state));
}

/** The session's start state, or null when it is gone (a re-provisioned container) or unusable. */
export function readState(tmpDir: string, sessionId: string): StartState | null {
  try {
    const state: unknown = JSON.parse(
      readFileSync(path.join(scratchDir(tmpDir), `${sessionId}.json`), 'utf8'),
    );
    if (typeof state !== 'object' || state === null) return null;
    const { repo, base_sha, builder_sha } = state as Record<string, unknown>;
    if (typeof repo !== 'string' || typeof base_sha !== 'string') return null;
    return { repo, base_sha, builder_sha: typeof builder_sha === 'string' ? builder_sha : null };
  } catch {
    return null;
  }
}

/**
 * Claim the session's first prompt: true exactly once per session, for whichever call creates the
 * `<session>.prompted` marker first (an exclusive create, so two racing prompts can't both win).
 * False once claimed, and false when the marker can't be written, since then a later prompt could
 * not be told apart from the first.
 */
export function claimFirstPrompt(tmpDir: string, sessionId: string): boolean {
  try {
    mkdirSync(scratchDir(tmpDir), { recursive: true });
    writeFileSync(path.join(scratchDir(tmpDir), `${sessionId}.prompted`), '', { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

/**
 * One line per failed write: time, event, session and the HTTP status or error name. Never a
 * header or a body. Logging must not fail the hook either, so its own errors are swallowed.
 */
export function logFailure(
  tmpDir: string,
  now: Date,
  event: string,
  sessionId: string,
  what: string,
): void {
  try {
    mkdirSync(scratchDir(tmpDir), { recursive: true });
    appendFileSync(
      path.join(scratchDir(tmpDir), 'hook.log'),
      `${now.toISOString()} · ${event} · ${sessionId} · ${what}\n`,
    );
  } catch {
    // Nowhere left to report to.
  }
}
