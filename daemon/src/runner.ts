import { EXPECTED_INTERVAL_SECONDS, INGEST_PAYLOAD_VERSION } from './contract.ts';
import type { IngestHeartbeat, IngestPayload, SourceKey } from './contract.ts';
import { resumeFrom } from './cursor.ts';
import type { HeartbeatSchedule } from './heartbeat.ts';
import type { SendResult } from './ingest-client.ts';
import type { Logger } from './log.ts';
import { createPendingBuffer } from './pending.ts';
import type { PendingBuffer } from './pending.ts';
import type { Source } from './sources/types.ts';
import type { SourceState } from './state.ts';

/**
 * One source's poll → batch → send cycle, with the state that has to survive between ticks.
 *
 * Every tick is self-contained and never throws: a source that fails is reported as an erroring
 * heartbeat, because the module's promise is that a zero means something. One source going down
 * must not take the other with it, so the caller runs each runner independently.
 */

export interface SourceRunnerDeps {
  source: Source;
  secrets: (name: string) => Promise<string>;
  send: (payload: IngestPayload) => Promise<SendResult>;
  heartbeats: HeartbeatSchedule;
  log: Logger;
  /** Where `--dry-run` writes normalized messages. */
  print?: (line: string) => void;
  dryRun?: boolean;
  /** The cached cursor from the last run of the process, if any. */
  initial?: SourceState;
  /** Called with the cursor worth caching after a batch is accepted. */
  persist?: (state: SourceState) => void;
  lookbackDays?: number;
  pending?: PendingBuffer;
}

export interface SourceRunner {
  key: SourceKey;
  label: string;
  tick(now: Date): Promise<void>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseStamp(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Retry backoff after a rejected send. Doubles with each consecutive failure so a dead or
 * misconfigured endpoint is checked on periodically rather than hammered at the full ~5s poll
 * cadence forever — the exact failure mode a rotated HMAC secret produced (see runner.test.ts and
 * the `mac-daemon` skill). Capped, on both curves, so a still-broken endpoint is still checked
 * eventually rather than abandoned.
 *
 * A non-retryable (4xx) failure gets a longer cap than a retryable (5xx/network) one: nothing
 * about waiting fixes a rejected secret, so there is no point checking it as often as a plain
 * outage that might clear on its own — it still gets retried (stopping entirely would mean the
 * pending buffer overflows with nobody told why), just less eagerly.
 */
const INITIAL_RETRY_DELAY_MS = 5000;
const RETRYABLE_MAX_DELAY_MS = 5 * 60_000;
const NON_RETRYABLE_MAX_DELAY_MS = 15 * 60_000;

function backoffDelayMs(consecutiveFailures: number, retryable: boolean): number {
  const cap = retryable ? RETRYABLE_MAX_DELAY_MS : NON_RETRYABLE_MAX_DELAY_MS;
  const delay = INITIAL_RETRY_DELAY_MS * 2 ** Math.max(0, consecutiveFailures - 1);
  return Math.min(delay, cap);
}

export function createSourceRunner(deps: SourceRunnerDeps): SourceRunner {
  const { source, log } = deps;
  const pending =
    deps.pending ??
    createPendingBuffer({
      onOverflow: (dropped) => {
        log.error('pending buffer overflowed — messages were DROPPED and will never be ingested', {
          source: source.key,
          dropped,
        });
      },
    });

  const localCursor = deps.initial?.cursor;
  /** Set by a successful poll in this process. Once set, it is the truth about where we are. */
  let polledCursor: unknown;
  let polledAtLeastOnce = false;
  /** The endpoint's answer — authoritative on startup, before this process has polled anything. */
  let serverCursor: unknown;
  let lastSeenAt = parseStamp(deps.initial?.lastSeenAt);
  let ownerHandles: string[] = [];
  /** Consecutive rejected sends. Reset to 0 on the next accepted send — see `backoffDelayMs`. */
  let consecutiveSendFailures = 0;
  /** Epoch ms before which a send is not attempted again. `undefined` means "no backoff owed". */
  let nextSendAttemptAtMs: number | undefined;

  async function tick(now: Date): Promise<void> {
    const resume = resumeFrom({
      serverCursor: polledAtLeastOnce ? polledCursor : serverCursor,
      ...(lastSeenAt === undefined ? {} : { serverLastSeenAt: lastSeenAt }),
      localCursor,
      now,
      ...(deps.lookbackDays === undefined ? {} : { lookbackDays: deps.lookbackDays }),
    });

    const heartbeat: IngestHeartbeat = { ok: true };
    try {
      const result = await source.poll({
        cursor: resume.cursor,
        anchor: resume.anchor,
        now,
        secrets: deps.secrets,
      });
      pending.add(result.messages);
      polledCursor = result.cursor;
      polledAtLeastOnce = true;
      ownerHandles = result.ownerHandles;
      heartbeat.cursor = result.cursor;
      if (result.messages.length > 0) {
        log.info('polled', { source: source.key, messages: result.messages.length });
      }
    } catch (error) {
      heartbeat.ok = false;
      heartbeat.error = describe(error);
      if (resume.cursor !== undefined) heartbeat.cursor = resume.cursor;
      log.error('poll failed', { source: source.key, error: heartbeat.error });
    }

    const messages = pending.all();

    if (deps.dryRun === true) {
      for (const message of messages) deps.print?.(JSON.stringify(message));
      pending.clear();
      return;
    }

    // Liveness coalesces: with nothing to send, at most one POST a minute per source.
    if (messages.length === 0 && !deps.heartbeats.due(source.key, now)) return;

    // Back off after a rejected send instead of retrying at full poll cadence: polling above still
    // ran (chat.db/IMAP are local and cheap to check), only the network attempt is throttled. A
    // batch withheld here is not lost — it just waits in `pending` for the next attempt.
    if (nextSendAttemptAtMs !== undefined && now.getTime() < nextSendAttemptAtMs) return;

    const payload: IngestPayload = {
      version: INGEST_PAYLOAD_VERSION,
      account: {
        key: source.key,
        kind: source.kind,
        label: source.label,
        owner_handles: ownerHandles,
        expected_interval_seconds: EXPECTED_INTERVAL_SECONDS,
      },
      heartbeat,
      messages,
    };

    const result = await deps.send(payload);
    if (!result.ok) {
      // Nothing is dropped and no beat is recorded: the next tick tries again with the same batch,
      // no sooner than the backoff below allows.
      consecutiveSendFailures += 1;
      const delay = backoffDelayMs(consecutiveSendFailures, result.retryable);
      nextSendAttemptAtMs = now.getTime() + delay;

      const fields = {
        source: source.key,
        messages: messages.length,
        error: result.error,
        status: result.status,
        retryable: result.retryable,
        consecutiveFailures: consecutiveSendFailures,
        retryInMs: delay,
      };
      if (result.retryable) {
        log.warn('batch not accepted — keeping it for the next tick', fields);
      } else {
        // A 4xx means the endpoint rejected the request itself — a rotated HMAC secret is the
        // headline case — not a transient outage, and no amount of retrying fixes that on its
        // own. This has to be LOUD and stay loud for as long as it persists: `pending` keeps
        // growing while this fails, and it drops its OLDEST messages once it hits its cap, so
        // every extra minute this goes unnoticed is messages permanently and silently lost.
        log.error(
          'ingest rejected the batch outright — this looks like a configuration problem (e.g. a ' +
            'rotated HMAC secret), not an outage; messages are queuing and will be DROPPED once ' +
            'the pending buffer fills',
          fields,
        );
      }
      return;
    }

    consecutiveSendFailures = 0;
    nextSendAttemptAtMs = undefined;
    pending.clear();
    deps.heartbeats.record(source.key, now);
    serverCursor = result.response.cursor;
    lastSeenAt = parseStamp(result.response.last_seen_at) ?? lastSeenAt;

    const cached: SourceState = {};
    const cursor = polledAtLeastOnce ? polledCursor : serverCursor;
    if (cursor !== undefined) cached.cursor = cursor;
    if (lastSeenAt !== undefined) cached.lastSeenAt = lastSeenAt.toISOString();
    if (Object.keys(cached).length > 0) deps.persist?.(cached);
  }

  return { key: source.key, label: source.label, tick };
}
