// Preloaded into the Next server (`NODE_OPTIONS=--import …`) so this demo's "the chart's gate
// is satisfied but GitHub says no" story is deterministic and self-contained — it never depends
// on whether the sandbox it runs in happens to have outbound network access to the real
// api.github.com (some do). Every request to that host is refused; everything else (the
// in-memory Supabase mock above all) goes to the real `fetch`.
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== 'api.github.com') return realFetch(input, init);

  // A bare refusal — no body, not the 202 "still computing" status — the same outcome the
  // route treats identically to a real outage or an expired token: no trustworthy count.
  return new Response('', { status: 503 });
};
