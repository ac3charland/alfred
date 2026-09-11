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
  /**
   * `now` is wall-clock — the instant reported to the server (the heartbeat, `poll()`'s anchor
   * fallback) and nothing else, because the server interprets it. `monotonicNowMs` is a
   * monotonic-clock reading (e.g. `performance.now()`), used only for this runner's own
   * backoff/deadline arithmetic, which must not be able to run backward — see
   * `nextSendAttemptAtMonotonicMs`.
   */
  tick(now: Date, monotonicNowMs: number): Promise<void>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The endpoint's `last_seen_at` (and this process's own cached copy of it, `SourceState.lastSeenAt`)
 * can carry a real JSON `null` — not merely an absent key — whenever the account has never had a
 * successful poll (see `contract.ts`). The `typeof` check below folds `null` and `undefined` into
 * the same "absent" branch on purpose, so a future third falsy-but-not-a-string case fails the same
 * safe way: `new Date(null)` is a VALID Date at the epoch, so a guard that checks only `undefined`
 * (as this one used to) lets `null` slip through and silently anchors the next poll at 1970 instead
 * of the seven-day first-run fallback — see runner.test.ts's regression test and the `mac-daemon`
 * skill.
 */
function parseStamp(value: string | null | undefined): Date | undefined {
  if (typeof value !== 'string') return undefined;
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
 *
 * The non-retryable cap is kept UNDER `EXPECTED_INTERVAL_SECONDS`, not just under the retryable
 * cap: heartbeats ride this same backed-off send path, so a cap at or beyond the declared
 * liveness interval means a backed-off daemon goes silent for exactly the stretch the server was
 * promised it never would, and gets marked stale on a schedule the daemon itself guaranteed it
 * could not keep. A previous, unfixed 15-minute cap did exactly that — 3x the 5-minute interval —
 * see the `mac-daemon` skill.
 */
const INITIAL_RETRY_DELAY_MS = 5000;
/**
 * The most messages one POST to `/comms/ingest` carries. The ceiling is the WORKER's, not the
 * daemon's: the ingest spends one Cloudflare subrequest per OUTBOUND message in the batch (it
 * drains that message's thread), plus the account upsert, the batch insert, the newsletter shelve
 * and the heartbeat — and the Workers runtime allows 50 outbound fetches per invocation on the
 * Free plan. A first run over an existing mailbox hands this runner hundreds of messages at once,
 * which as a single POST exceeds that budget and is 503'd in full, forever. At 25 the worst case
 * (every message outbound) is ~29 — comfortably inside 50.
 *
 * A backlog is transient: once a source is caught up, a tick's poll returns a handful of messages
 * and this cap is never reached, so draining the initial burst over a few consecutive ticks costs
 * nothing anyone is waiting for.
 */
export const MAX_INGEST_BATCH_MESSAGES = 25;

const RETRYABLE_MAX_DELAY_MS = 5 * 60_000;
const NON_RETRYABLE_MAX_DELAY_MS = Math.floor((EXPECTED_INTERVAL_SECONDS * 1000) / 2);

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
      onOverflow: (size, limit) => {
        // Nothing is dropped (see pending.ts) — this firing at all means the "only re-poll once
        // empty" invariant below broke upstream, which should never happen. Logged immediately for
        // whoever is tailing the log, but stderr on a headless launchd process is not a surface the
        // owner reliably sees — the heartbeat check below is what actually surfaces this.
        log.error('pending buffer exceeded its limit — this should be unreachable', {
          source: source.key,
          size,
          limit,
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
  /**
   * A monotonic-clock reading (see `tick`'s `monotonicNowMs` parameter — never wall-clock)
   * before which a send is not attempted again. `undefined` means "no backoff owed".
   *
   * Wall-clock `Date` is the wrong tool for this specific comparison, deliberately: this daemon
   * runs on a laptop, where sleep/wake cycles and NTP corrections are routine, not exceptional. A
   * backward jump would silently stretch a backoff by however far the clock moved — with no
   * ceiling, since the comparison below would just keep reading "not yet" — and that now matters
   * more than it once did, because `pending` (see pending.ts) no longer evicts to make room: a
   * backoff stuck open long enough escalates to an unhealthy heartbeat instead.
   */
  let nextSendAttemptAtMonotonicMs: number | undefined;

  async function tick(now: Date, monotonicNowMs: number): Promise<void> {
    const resume = resumeFrom({
      serverCursor: polledAtLeastOnce ? polledCursor : serverCursor,
      ...(lastSeenAt === undefined ? {} : { serverLastSeenAt: lastSeenAt }),
      localCursor,
      now,
      ...(deps.lookbackDays === undefined ? {} : { lookbackDays: deps.lookbackDays }),
    });

    const heartbeat: IngestHeartbeat = { ok: true };

    // A message is only ever "read" by calling poll() — the source's own cursor moves the instant
    // it returns, independent of whether the batch it carries is ever successfully sent. So this
    // only reads further once everything already read has cleared `pending`: reading ahead into a
    // backlog the daemon cannot yet deliver is exactly how an ordinary retryable outage turns into
    // silent, permanent data loss — the poll cursor never looks back, so once it has advanced past
    // a message, that message is gone the moment `pending` would otherwise have to drop it. See the
    // `mac-daemon` skill and this file's "never discards a read message" test.
    if (pending.size() === 0) {
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
    } else {
      if (polledAtLeastOnce) heartbeat.cursor = polledCursor;
      log.info('holding off on polling — pending still holds an unsent batch', {
        source: source.key,
        pending: pending.size(),
      });
    }

    // pending.ts never evicts to stay under its limit, so this can only be true if the
    // "only re-poll once empty" invariant above was somehow bypassed (a custom `deps.pending`, a
    // future bug). Escalate it onto the heartbeat that ships to the server: stderr on a headless
    // launchd process is easy to never see, and a message queuing unsent past the bound this
    // buffer was sized for is exactly the kind of problem a green account dot must not hide.
    if (pending.size() > pending.limit()) {
      heartbeat.ok = false;
      heartbeat.error = `pending buffer holding ${String(pending.size())} messages, over its ${String(pending.limit())} limit`;
    }

    // One bounded chunk per tick — the rest stays held and goes out on the ticks that follow.
    const held = pending.all();
    const messages = held.slice(0, MAX_INGEST_BATCH_MESSAGES);

    if (deps.dryRun === true) {
      // Everything held, not just this tick's chunk: nothing is being POSTed, so there is no
      // budget to respect and a dry run should show the whole backlog it would have sent.
      for (const message of held) deps.print?.(JSON.stringify(message));
      pending.clear();
      return;
    }

    // Liveness coalesces: with nothing to send, at most one POST a minute per source.
    if (messages.length === 0 && !deps.heartbeats.due(source.key, now)) return;

    // Back off after a rejected send instead of retrying at full poll cadence: polling above still
    // ran (chat.db/IMAP are local and cheap to check), only the network attempt is throttled. A
    // batch withheld here is not lost — it just waits in `pending` for the next attempt. Gated on
    // the monotonic clock, not `now` — see `nextSendAttemptAtMonotonicMs`.
    if (nextSendAttemptAtMonotonicMs !== undefined && monotonicNowMs < nextSendAttemptAtMonotonicMs)
      return;

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
      nextSendAttemptAtMonotonicMs = monotonicNowMs + delay;

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
        // own. This has to be LOUD and stay loud for as long as it persists: the source has
        // stopped being read further while this batch sits unsent (see the poll gate above), so
        // nothing here is silently piling up or being dropped — but every message behind this one
        // is stuck, unread, until someone fixes the underlying problem.
        log.error(
          'ingest rejected the batch outright — this looks like a configuration problem (e.g. a ' +
            'rotated HMAC secret), not an outage; the source has stopped reading further until ' +
            'this batch is accepted',
          fields,
        );
      }
      return;
    }

    consecutiveSendFailures = 0;
    nextSendAttemptAtMonotonicMs = undefined;
    // Only the chunk that was actually accepted — `clear()` here would silently discard the
    // untried remainder, which no source cursor can re-read.
    pending.drop(messages.length);
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
