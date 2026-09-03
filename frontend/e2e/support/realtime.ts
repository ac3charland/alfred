import type { Page } from '@playwright/test';

/**
 * Fake the Supabase realtime socket, so a test can push a `postgres_changes` UPDATE the way a
 * Worker's out-of-band write reaches an open tab.
 *
 * The mock backend speaks PostgREST + GoTrue only — no websocket — so a channel's `.subscribe()`
 * never joins and nothing a store subscribes to can be exercised end to end. realtime-js v2
 * frames are plain JSON arrays `[join_ref, ref, topic, event, payload]`, so a `WebSocket` that
 * answers `phx_join` and delivers one frame is the whole harness.
 *
 * Two details make or break it: the join reply must echo the client's own
 * `payload.config.postgres_changes` filters back **with an `id` each** (the channel errors with
 * "mismatch between server and client bindings" otherwise), and a pushed frame's `ids` must list
 * the id of the binding it is for. `columns: []` passes the record's values through unconverted.
 */
interface RealtimeStub {
  deliver: ((frame: unknown) => void) | undefined;
  /** Binding topic + id per subscribed table, filled in as each channel joins. */
  bindings: Record<string, { topic: string; id: number }>;
}

const STUB_KEY = '__realtimeStub';

/** Install the stub. Call before `page.goto` — it runs as an init script on every navigation. */
export async function installRealtimeStub(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    const stub: RealtimeStub = { deliver: undefined, bindings: {} };
    (globalThis as unknown as Record<string, RealtimeStub>)[key] = stub;

    /** One shape for all four slots, so a listener can be routed to any of them. */
    type SocketHandler = ((event: { data?: string }) => void) | null;

    /**
     * Which slot each listener type writes. A lookup rather than a branch per slot: written as
     * `this.onmessage = listener`, `unicorn/prefer-add-event-listener` autofixes the assignment
     * into `this.addEventListener('message', listener)` — which, inside the very method
     * `addEventListener` delegates to, is infinite recursion. A computed key says the same thing
     * and leaves nothing for the rule to rewrite.
     */
    const SLOTS: Record<string, 'onopen' | 'onmessage' | 'onclose' | 'onerror' | undefined> = {
      open: 'onopen',
      message: 'onmessage',
      close: 'onclose',
      error: 'onerror',
    };

    class FakeSocket {
      readyState = 0;
      onopen: SocketHandler = null;
      onmessage: SocketHandler = null;
      onerror: SocketHandler = null;
      onclose: SocketHandler = null;

      constructor() {
        stub.deliver = (frame) => {
          this.onmessage?.({ data: JSON.stringify(frame) });
        };
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.({});
        }, 0);
      }

      send(raw: string) {
        const [joinRef, ref, topic, event, payload] = JSON.parse(raw) as [
          string | null,
          string | null,
          string,
          string,
          { config?: { postgres_changes?: { table?: string }[] } } | null,
        ];
        if (event === 'phx_join') {
          const changes = (payload?.config?.postgres_changes ?? []).map((filter, index) => ({
            id: index + 1,
            ...filter,
          }));
          for (const change of changes) {
            if (change.table !== undefined) stub.bindings[change.table] = { topic, id: change.id };
          }
          stub.deliver?.([
            joinRef,
            ref,
            topic,
            'phx_reply',
            { status: 'ok', response: { postgres_changes: changes } },
          ]);
        } else if (ref !== null) {
          // Heartbeats and access_token pushes just need an ok.
          stub.deliver?.([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]);
        }
      }

      close() {
        this.readyState = 3;
        this.onclose?.({});
      }

      // The client sets `onmessage` &c. directly, but a listener registered the other way must
      // still fire — so route both forms at the same four slots rather than swallowing one.
      addEventListener(type: string, listener: SocketHandler) {
        this.slotFor(type, listener);
      }
      removeEventListener(type: string) {
        this.slotFor(type, null);
      }
      private slotFor(type: string, listener: SocketHandler) {
        const slot = SLOTS[type];
        if (slot !== undefined) this[slot] = listener;
      }
    }

    // Only the realtime socket is faked, so anything else on the page keeps a real one. The
    // substitute must be constructible — the client builds its transport with `new` — which a
    // `construct` trap serves without inventing a class that exists only to return something else.
    globalThis.WebSocket = new Proxy(globalThis.WebSocket, {
      construct: (target, args: [string | URL, (string | string[])?]) =>
        String(args[0]).includes('/realtime/') ? new FakeSocket() : new target(...args),
    });
  }, STUB_KEY);
}

/** Resolve once a channel for `table` has joined, so a push can't land before its binding. */
export async function waitForRealtimeJoin(page: Page, table: string): Promise<void> {
  await page.waitForFunction(
    ({ key, name }) =>
      (globalThis as unknown as Record<string, RealtimeStub | undefined>)[key]?.bindings[name] !==
      undefined,
    { key: STUB_KEY, name: table },
  );
}

/** Push one UPDATE down the faked socket, as the database would when a Worker writes a row. */
export async function pushRowUpdate(
  page: Page,
  table: string,
  record: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ({ key, name, row }) => {
      const stub = (globalThis as unknown as Record<string, RealtimeStub | undefined>)[key];
      const binding = stub?.bindings[name];
      if (stub === undefined || binding === undefined) throw new Error(`no binding for ${name}`);
      stub.deliver?.([
        null,
        null,
        binding.topic,
        'postgres_changes',
        {
          ids: [binding.id],
          data: {
            schema: 'public',
            table: name,
            commit_timestamp: '2026-01-01T00:00:00Z',
            type: 'UPDATE',
            columns: [],
            record: row,
            old_record: {},
          },
        },
      ]);
    },
    { key: STUB_KEY, name: table, row: record },
  );
}
