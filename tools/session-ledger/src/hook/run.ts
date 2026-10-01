import type { GitRunner } from '../git.ts';
import type { JsonObject } from '../types.ts';
import { errorName, named } from './failure.ts';
import { startBody } from './start.ts';
import { logFailure } from './state.ts';
import { stopBody } from './stop.ts';

/**
 * The recording hook. It runs inside every cloud session's shell, so the contract is that it is
 * invisible: it always finishes normally, prints nothing (except the body under `--dry-run`),
 * and records a failure as one line in a log file rather than anywhere the session can see.
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

async function transcriptPathFromStdin(deps: HookDeps): Promise<string> {
  const input: unknown = JSON.parse(await deps.readStdin());
  const transcriptPath =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)['transcript_path']
      : undefined;
  if (typeof transcriptPath !== 'string' || transcriptPath === '') {
    throw named('TranscriptPathMissing');
  }
  return transcriptPath;
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

/** Record one hook event. `argv` is the CLI's arguments: the event, then `--dry-run` if given. */
export async function runHook(argv: readonly string[], deps: HookDeps): Promise<void> {
  const [event] = argv;
  if (event !== 'session-start' && event !== 'stop') return;

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
    const body =
      event === 'stop'
        ? stopBody({
            sessionId,
            transcriptPath: await transcriptPathFromStdin(deps),
            env: deps.env,
            git: deps.git,
            tmpDir: deps.tmpDir,
          })
        : startBody({ sessionId, git: deps.git, tmpDir: deps.tmpDir, now: deps.now() });
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
