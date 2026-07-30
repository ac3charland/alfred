# Driving a Supabase realtime event in the harness

The mock backend speaks PostgREST + GoTrue only — no websocket — so a channel `.subscribe()`
never joins and a feature that reacts to a realtime UPDATE (the code store's move alert, the tab
-title marker) can't be exercised end to end. Stub the socket instead: realtime-js v2 frames are
plain JSON arrays `[join_ref, ref, topic, event, payload]`, so a fake `WebSocket` that answers
`phx_join` and pushes one `postgres_changes` frame is enough.

Two details make or break it: the join reply must echo the client's own
`payload.config.postgres_changes` filters back **with an `id` each** (the channel errors with
"mismatch between server and client bindings" otherwise), and the pushed frame's `ids` must list
those same ids or the binding never fires. `columns: []` passes record values through unconverted.

```ts
await page.addInitScript(() => {
  const RealWebSocket = window.WebSocket;
  class FakeSocket {
    readyState = 0;
    onopen = null; onmessage = null; onerror = null; onclose = null;
    constructor(url) {
      window.__fakeSocket = this;
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }
    deliver(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
    send(raw) {
      const [joinRef, ref, topic, event, payload] = JSON.parse(raw);
      if (event === 'phx_join') {
        const changes = (payload?.config?.postgres_changes ?? [])
          .map((filter, index) => ({ id: index + 1, ...filter }));
        if (topic.includes('code_items')) window.__codeTopic = { topic, id: changes[0]?.id };
        this.deliver([joinRef, ref, topic, 'phx_reply',
          { status: 'ok', response: { postgres_changes: changes } }]);
      } else if (ref) {
        // Heartbeats and access_token pushes just need an ok.
        this.deliver([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]);
      }
    }
    close() { this.readyState = 3; this.onclose?.({}); }
    addEventListener() {} removeEventListener() {}
  }
  // Only the realtime socket is faked, so anything else on the page keeps a real one.
  window.WebSocket = (url, protocols) =>
    String(url).includes('/realtime/') ? new FakeSocket(url) : new RealWebSocket(url, protocols);
  window.pushCodeItemUpdate = (record) => {
    const { topic, id } = window.__codeTopic;
    window.__fakeSocket.deliver([null, null, topic, 'postgres_changes', {
      ids: [id],
      data: { schema: 'public', table: 'code_items', commit_timestamp: '2026-01-01T00:00:00Z',
              type: 'UPDATE', columns: [], record, old_record: {} },
    }]);
  };
});
await page.goto('/?view=inbox');
await page.waitForFunction(() => window.__codeTopic !== undefined);   // joined
await page.evaluate((row) => { window.pushCodeItemUpdate(row); }, { ...story, factory_state: 'ready_for_dev' });
```

**Write the row to the mock first** (`page.request.patch('/api/code/ALF-3', { data: … })`) when the
test then navigates. The frame only patches the client store; a route change that re-seeds a
provider from the server would otherwise snap the story back to its stale seeded state — visible as
a screenshot whose modal contradicts the toast that opened it.
