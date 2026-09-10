import type { IngestPayload, NormalizedMessage } from './contract.ts';
import { createHeartbeatSchedule } from './heartbeat.ts';
import type { SendResult } from './ingest-client.ts';
import { createLogger } from './log.ts';
import { createSourceRunner } from './runner.ts';
import type { SourceRunnerDeps } from './runner.ts';
import type { PollResult, Source, SourceContext } from './sources/types.ts';
import type { SourceState } from './state.ts';

const NOW = new Date('2026-09-09T12:00:00.000Z');

/** Log output is captured and never asserted on. */
const captured: string[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;

function later(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

function message(id: string): NormalizedMessage {
  return {
    source_id: id,
    thread_key: 'chat-1',
    direction: 'inbound',
    sender_handle: '+15550100',
    participants: ['+15550100'],
    body: id,
    received_at: NOW.toISOString(),
    body_extracted: true,
    has_attachments: false,
    references_ids: [],
  };
}

/** A source whose polls are scripted, recording the context each one was handed. */
function scriptedSource(polls: (() => Promise<PollResult>)[]): {
  source: Source;
  contexts: SourceContext[];
} {
  const contexts: SourceContext[] = [];
  let index = 0;
  return {
    contexts,
    source: {
      key: 'imessage',
      kind: 'imessage',
      label: 'iMessage',
      check: () => Promise.resolve({ ok: true }),
      poll: (ctx) => {
        contexts.push(ctx);
        const next = polls[Math.min(index, polls.length - 1)];
        index += 1;
        return next === undefined ? Promise.resolve(empty()) : next();
      },
    },
  };
}

function empty(cursor?: unknown): PollResult {
  return { messages: [], cursor, ownerHandles: [] };
}

function polled(messages: NormalizedMessage[], cursor: unknown): () => Promise<PollResult> {
  return () => Promise.resolve({ messages, cursor, ownerHandles: ['+15550199'] });
}

function accepted(overrides: Record<string, unknown> = {}): SendResult {
  return {
    ok: true,
    response: { accepted: 0, duplicates: 0, drained: 0, ...overrides },
  };
}

interface Harness {
  sent: IngestPayload[];
  printed: string[];
  persisted: SourceState[];
  deps: SourceRunnerDeps;
}

function harness(
  source: Source,
  options: {
    send?: (payload: IngestPayload) => Promise<SendResult>;
    dryRun?: boolean;
    initial?: SourceState;
  } = {},
): Harness {
  const sent: IngestPayload[] = [];
  const printed: string[] = [];
  const persisted: SourceState[] = [];
  const send = options.send ?? ((): Promise<SendResult> => Promise.resolve(accepted()));

  return {
    sent,
    printed,
    persisted,
    deps: {
      source,
      secrets: () => Promise.resolve('a-secret'),
      send: (payload) => {
        sent.push(payload);
        return send(payload);
      },
      heartbeats: createHeartbeatSchedule(),
      log: createLogger({ out: (line) => captured.push(line), err: (line) => captured.push(line) }),
      print: (line) => printed.push(line),
      dryRun: options.dryRun ?? false,
      ...(options.initial === undefined ? {} : { initial: options.initial }),
      persist: (state) => persisted.push(state),
    },
  };
}

describe('createSourceRunner', () => {
  it('sends the polled messages under the account envelope', async () => {
    const { source } = scriptedSource([polled([message('m1')], { rowid: 7 })]);
    const { sent, deps } = harness(source);

    await createSourceRunner(deps).tick(NOW);

    expect(sent).toEqual([
      {
        version: 1,
        account: {
          key: 'imessage',
          kind: 'imessage',
          label: 'iMessage',
          owner_handles: ['+15550199'],
          expected_interval_seconds: 300,
        },
        heartbeat: { ok: true, cursor: { rowid: 7 } },
        messages: [message('m1')],
      },
    ]);
  });

  it('clears the batch once it is accepted', async () => {
    const { source } = scriptedSource([
      polled([message('m1')], { rowid: 7 }),
      () => Promise.resolve(empty({ rowid: 7 })),
    ]);
    const { sent, deps } = harness(source);
    const runner = createSourceRunner(deps);

    await runner.tick(NOW);
    await runner.tick(later(5000));

    expect(sent).toHaveLength(1);
  });

  it('reports a failed poll as an erroring heartbeat instead of crashing the loop', async () => {
    const { source } = scriptedSource([
      () => Promise.reject(new Error('chat.db: operation not permitted')),
    ]);
    const { sent, deps } = harness(source);

    await createSourceRunner(deps).tick(NOW);

    expect(sent[0]?.heartbeat).toEqual({
      ok: false,
      error: 'chat.db: operation not permitted',
    });
    expect(sent[0]?.messages).toEqual([]);
  });

  it('keeps an unaccepted batch for the next tick, exactly once', async () => {
    let attempt = 0;
    const { source } = scriptedSource([
      polled([message('m1')], { rowid: 7 }),
      () => Promise.resolve(empty({ rowid: 7 })),
    ]);
    const { sent, deps } = harness(source, {
      send: () => {
        attempt += 1;
        return Promise.resolve(
          attempt === 1 ? { ok: false, error: 'ingest POST rejected with 503' } : accepted(),
        );
      },
    });
    const runner = createSourceRunner(deps);

    await runner.tick(NOW);
    await runner.tick(later(5000));

    expect(sent).toHaveLength(2);
    expect(sent[1]?.messages).toEqual([message('m1')]);
  });

  it('stays quiet between beats when there is nothing to send', async () => {
    const { source } = scriptedSource([() => Promise.resolve(empty({ rowid: 7 }))]);
    const { sent, deps } = harness(source);
    const runner = createSourceRunner(deps);

    await runner.tick(NOW);
    await runner.tick(later(5000));
    await runner.tick(later(10_000));

    expect(sent).toHaveLength(1);
  });

  it('beats again once the minute is up', async () => {
    const { source } = scriptedSource([() => Promise.resolve(empty({ rowid: 7 }))]);
    const { sent, deps } = harness(source);
    const runner = createSourceRunner(deps);

    await runner.tick(NOW);
    await runner.tick(later(60_000));

    expect(sent).toHaveLength(2);
  });

  it('prints and sends nothing in a dry run', async () => {
    const { source } = scriptedSource([polled([message('m1')], { rowid: 7 })]);
    const { sent, printed, deps } = harness(source, { dryRun: true });

    await createSourceRunner(deps).tick(NOW);

    expect(sent).toEqual([]);
    expect(printed).toEqual([JSON.stringify(message('m1'))]);
  });

  it('resumes from the cached cursor and the seven-day anchor on a first run', async () => {
    const { source, contexts } = scriptedSource([() => Promise.resolve(empty({ rowid: 8 }))]);
    const { deps } = harness(source, { initial: { cursor: { rowid: 3 } } });

    await createSourceRunner(deps).tick(NOW);

    expect(contexts[0]?.cursor).toEqual({ rowid: 3 });
    expect(contexts[0]?.anchor).toEqual(new Date(NOW.getTime() - 7 * DAY_MS));
  });

  it('carries its own cursor forward after a successful poll', async () => {
    const { source, contexts } = scriptedSource([
      () => Promise.resolve(empty({ rowid: 8 })),
      () => Promise.resolve(empty({ rowid: 9 })),
    ]);
    const { deps } = harness(source);
    const runner = createSourceRunner(deps);

    await runner.tick(NOW);
    await runner.tick(later(60_000));

    expect(contexts[1]?.cursor).toEqual({ rowid: 8 });
  });

  it("adopts the server's cursor and last-seen stamp while it has never polled successfully", async () => {
    const { source, contexts } = scriptedSource([
      () => Promise.reject(new Error('chat.db locked')),
      () => Promise.resolve(empty({ rowid: 20 })),
    ]);
    const { deps } = harness(source, {
      send: () =>
        Promise.resolve(
          accepted({ cursor: { rowid: 19 }, last_seen_at: '2026-09-02T12:00:00.000Z' }),
        ),
    });
    const runner = createSourceRunner(deps);

    await runner.tick(NOW);
    await runner.tick(later(60_000));

    expect(contexts[1]?.cursor).toEqual({ rowid: 19 });
    expect(contexts[1]?.anchor).toEqual(new Date('2026-09-02T12:00:00.000Z'));
  });

  it('caches the cursor and last-seen stamp for a fast restart', async () => {
    const { source } = scriptedSource([polled([message('m1')], { rowid: 7 })]);
    const { persisted, deps } = harness(source, {
      send: () =>
        Promise.resolve(
          accepted({ cursor: { rowid: 7 }, last_seen_at: '2026-09-09T12:00:00.000Z' }),
        ),
    });

    await createSourceRunner(deps).tick(NOW);

    expect(persisted).toEqual([{ cursor: { rowid: 7 }, lastSeenAt: '2026-09-09T12:00:00.000Z' }]);
  });

  it('does not cache anything when the batch was never accepted', async () => {
    const { source } = scriptedSource([polled([message('m1')], { rowid: 7 })]);
    const { persisted, deps } = harness(source, {
      send: () => Promise.resolve({ ok: false, error: 'ingest POST rejected with 503' }),
    });

    await createSourceRunner(deps).tick(NOW);

    expect(persisted).toEqual([]);
  });
});
