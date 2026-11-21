import type { GitRunner } from '../git.ts';
import type { JsonObject } from '../types.ts';
import { errorName, named } from './failure.ts';
import { promptBody } from './prompt.ts';
import { startBody } from './start.ts';
import { claimFirstPrompt, logFailure, readState } from './state.ts';
import { stopBody } from './stop.ts';

/**
 * The recording hook. It runs inside every cloud session's shell, so the contract is that it is
 * invisible: it always finishes normally, prints nothing (except the body under `--dry-run`),
 * and records a failure as one line in a log file rather than anywhere the session can see. Silence
 * matters most on UserPromptSubmit, whose stdout on exit 0 is added to the model's context.
 */

const SESSION_ID_PREFIX = 'cse_';
const RECORD_PATH = '/api/code/sessions/record';
const FETCH_TIMEOUT_MS = 5000;

export interface HookDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  /** The hook's JSON stdin; only read once the gate has passed. */
  readStdin: () => Promise<string>;
  git: GitRunner;
  now: () => Date;
  tmpDir: string;
  /** stdout, written only by `--dry-run`. */
  write: (text: string) => void;
  /** Overrides the five-second request limit, for tests. */
  timeoutMs?: number;
}

/** `ALFRED_BASE_URL` as the cloud environment sets it has no scheme. */
function recordUrl(base: string): string {
  const origin = /^[a-z][a-z\d+.-]*:\/\//i.test(base) ? base : `https://${base}`;
  return `${origin.replace(/\/+$/, '')}${RECORD_PATH}`;
}

/** A non-empty string field of the hook's JSON stdin, or a throw named `missing`. */
async function stdinField(deps: HookDeps, field: string, missing: string): Promise<string> {
  const input: unknown = JSON.parse(await deps.readStdin());
  const value =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)[field]
      : undefined;
  if (typeof value !== 'string' || value === '') throw named(missing);
  return value;
}

/**
 * The first-prompt write, or null when this prompt must not write. Only the first prompt after a
 * recorded start writes: with no start state (a resumed or re-provisioned container) this prompt
 * may be a later one, like "ok, go ahead", which must never become the frozen launch prompt — the
 * stop heals the row from the transcript instead. The prompt is claimed before stdin is read or
 * anything is sent, so a slow first write can't race a second prompt.
 */
async function firstPromptBody(deps: HookDeps, sessionId: string): Promise<JsonObject | null> {
  const state = readState(deps.tmpDir, sessionId);
  if (state === null || !claimFirstPrompt(deps.tmpDir, sessionId)) return null;
  return promptBody({
    sessionId,
    prompt: await stdinField(deps, 'prompt', 'PromptMissing'),
    state,
    git: deps.git,
  });
}

/** The body for one event, or null when the event has nothing to send. */
async function bodyFor(
  event: HookEvent,
  deps: HookDeps,
  sessionId: string,
): Promise<JsonObject | null> {
  switch (event) {
    case 'session-start': {
      return startBody({ sessionId, git: deps.git, tmpDir: deps.tmpDir, now: deps.now() });
    }
    case 'prompt': {
      return firstPromptBody(deps, sessionId);
    }
    case 'stop': {
      return stopBody({
        sessionId,
        transcriptPath: await stdinField(deps, 'transcript_path', 'TranscriptPathMissing'),
        env: deps.env,
        git: deps.git,
        tmpDir: deps.tmpDir,
      });
    }
  }
}

/** POST the body; the HTTP status when alfred refused it, null when it took it. */
async function post(deps: HookDeps, url: string, body: JsonObject): Promise<number | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // In the cloud a proxy attaches the credential itself; the key is for any other host.
  const key = deps.env['LEDGER_API_KEY'];
  if (key !== undefined && key !== '') headers['Authorization'] = `Bearer ${key}`;
  const response = await deps.fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(deps.timeoutMs ?? FETCH_TIMEOUT_MS),
  });
  await response.body?.cancel();
  return response.ok ? null : response.status;
}

const EVENTS = ['session-start', 'prompt', 'stop'] as const;
type HookEvent = (typeof EVENTS)[number];

function isEvent(value: string | undefined): value is HookEvent {
  return (EVENTS as readonly (string | undefined)[]).includes(value);
}

/** Record one hook event. `argv` is the CLI's arguments: the event, then `--dry-run` if given. */
export async function runHook(argv: readonly string[], deps: HookDeps): Promise<void> {
  const [event] = argv;
  if (!isEvent(event)) return;

  // The gate: only alfred's cloud sessions record, and only where alfred is configured. A dry
  // run needs no host since it only prints.
  const remoteId = deps.env['CLAUDE_CODE_REMOTE_SESSION_ID'] ?? '';
  const dryRun = argv.includes('--dry-run');
  const baseUrl = (deps.env['ALFRED_BASE_URL'] ?? '').trim();
  if (!remoteId.startsWith(SESSION_ID_PREFIX) || remoteId.length === SESSION_ID_PREFIX.length) {
    return;
  }
  if (baseUrl === '' && !dryRun) return;

  const sessionId = `session_${remoteId.slice(SESSION_ID_PREFIX.length)}`;
  const fail = (what: string): void => {
    logFailure(deps.tmpDir, deps.now(), event, sessionId, what);
  };
  try {
    const body = await bodyFor(event, deps, sessionId);
    if (body === null) return;
    if (dryRun) {
      deps.write(`${JSON.stringify(body, null, 2)}\n`);
      return;
    }
    const refused = await post(deps, recordUrl(baseUrl), body);
    if (refused !== null) fail(String(refused));
  } catch (error) {
    fail(errorName(error));
  }
}
