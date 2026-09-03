# Driving a Supabase realtime event in the harness

The mock backend speaks PostgREST + GoTrue only — no websocket — so a channel's `.subscribe()`
never joins and a feature that reacts to a realtime UPDATE (a classifier verdict landing in the
Inbox, the code store's move alert, the tab-title marker) can't be exercised end to end.

`e2e/support/realtime.ts` is the stub. Three calls:

```ts
await installRealtimeStub(page);          // before page.goto — it is an init script
await page.goto('/?view=inbox');
await waitForRealtimeJoin(page, 'items'); // the binding exists only once the channel joins
await pushRowUpdate(page, 'items', { ...row, classified_provider: 'anthropic' });
```

What makes it work, if you ever have to touch it:

- realtime-js v2 frames are plain JSON arrays `[join_ref, ref, topic, event, payload]`.
- The join reply must echo the client's own `payload.config.postgres_changes` filters back **with
  an `id` each**, or the channel errors with "mismatch between server and client bindings"; a
  pushed frame's `ids` must then list the id of the binding it is for. `columns: []` passes the
  record's values through unconverted.
- Substitute `globalThis.WebSocket` with a **class**, never an arrow function: the client builds
  its transport with `new`, which an arrow function cannot serve — the socket is never
  constructed, no channel ever joins, and the only symptom is a `waitForFunction` that times out.
  A constructor may `return` another object, which is what lets one class serve both the fake and
  a real socket for every other URL.

**Write the row to the mock first** (`page.request.patch('/api/code/ALF-3', { data: … })`) when the
test then navigates. The frame only patches the client store; a route change that re-seeds a
provider from the server would otherwise snap the row back to its stale seeded state — visible as
a screenshot whose modal contradicts the toast that opened it.
