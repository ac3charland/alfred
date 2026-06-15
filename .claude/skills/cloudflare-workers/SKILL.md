---
name: cloudflare-workers
description: >
  Covers Cloudflare Workers development (TypeScript, Wrangler) for the workers/ package:
  the ES-module fetch-handler shape, typed Env bindings, secrets and env vars, wrangler.toml/wrangler.jsonc
  config, local dev (wrangler dev) and deploy (wrangler deploy), ctx.waitUntil, fetch to external services
  (Supabase REST, Anthropic API), Node.js compat for SDKs, and TypeScript typing via wrangler types.
  Use when creating or modifying a Worker entrypoint, adding or reading a binding/secret, configuring
  wrangler.toml, running or deploying a Worker, calling Supabase or an LLM from a Worker, or validating
  an API key inside a Worker. Do NOT use for Next.js API routes (frontend/ package — use the nextjs skill).
---

# Cloudflare Workers Skill

## Mental Model: V8 Isolates, Not Node Processes

A Cloudflare Worker is **not** a Node.js process. It is a JavaScript module executed inside a V8 isolate
on Cloudflare's edge network. The key consequences:

- **No file system, no `process.env`, no `require()`** by default. Everything comes in through the `env`
  parameter or Web-standard globals (`fetch`, `crypto`, `URL`, `Request`, `Response`).
- **Isolates are reused across requests.** Module-level (global) state persists between requests within
  the same isolate. Never store per-request data in module scope; pass it through function arguments.
- **Execution is event-driven.** The runtime calls your exported `fetch` handler for each HTTP request.
  Your handler must return a `Response` (or a `Promise<Response>`) before the isolate is yielded back.
  Code that runs after the response is returned belongs in `ctx.waitUntil(promise)`.
- **CPU time, not wall time.** The free plan allows 10 ms of CPU time; the paid plan allows up to 5 minutes
  (as of March 2025). Time spent awaiting network I/O does not count against the CPU limit, so LLM calls
  and Supabase queries are fine on paid plans.
- **Node.js built-ins are absent unless you opt in.** The `nodejs_compat` compatibility flag adds polyfills
  for `node:crypto`, `node:buffer`, `node:stream`, etc. Most npm SDKs (including `@anthropic-ai/sdk` and
  `@supabase/supabase-js`) require this flag. Without it, you get cryptic `module not found` errors at
  runtime, not at build time.

> Source: Cloudflare Workers docs — "Migrate from Service Workers to ES Modules", "Node.js compatibility",
> "Context (ctx)", "Limits" — developers.cloudflare.com/workers (fetched June 2026)

---

## Decision Tree: Key Forks Before You Write Code

**Module workers vs. service workers?**
Always use module workers (the `export default { fetch }` shape). The `addEventListener('fetch', ...)` form
is the legacy service-worker syntax — it still runs but is explicitly deprecated. Agents trained before 2023
will default to it; always use module syntax instead.

**wrangler.toml vs. wrangler.jsonc?**
Both work. `wrangler.toml` is the traditional format; `wrangler.jsonc` is JSON-with-comments (the format
`npm create cloudflare` now scaffolds by default as of Wrangler v4). Either is fine; use whichever the
project already has. This skill shows TOML examples (more common in existing projects) with JSON equivalents
noted where they differ.

**`[vars]` in wrangler.toml vs. `wrangler secret put`?**
`[vars]` is for non-sensitive config (e.g., environment name, API endpoint URLs). Use `wrangler secret put`
for anything that must be kept out of source control: API keys, tokens, database passwords. Secrets are
encrypted at rest; `[vars]` values appear in plain text in `wrangler.toml`.

**`@cloudflare/workers-types` vs. `wrangler types`?**
Use `wrangler types` (generates `worker-configuration.d.ts`). It produces an `Env` interface that exactly
matches your `wrangler.toml` bindings AND generates runtime types scoped to your `compatibility_date` and
flags. `@cloudflare/workers-types` is a static package that can lag behind your actual runtime. Run
`wrangler types` after every config change; add it to your `prepare` script.

---

## Plain-English → Pattern Table

| When the user/task says... | Pattern to use | Key things to know |
|---|---|---|
| "a Worker endpoint that validates an API key" | Read `Authorization` header; compare with `env.API_KEY` secret using `crypto.subtle.timingSafeEqual()` | Never use `===` for secret comparison — timing side-channel. Encode both values to equal-length buffers first (e.g., via SHA-256 hash). Return `401` before any further processing if validation fails. |
| "store a secret (API key, token, password)" | `npx wrangler secret put MY_SECRET_NAME` then access as `env.MY_SECRET_NAME` in the handler | Put local dev value in `.dev.vars` (dotenv format, never commit). Do not put secrets in `[vars]` — that section is visible in source. |
| "non-sensitive config var (API URL, env name)" | `[vars]` section in `wrangler.toml`: `MY_VAR = "value"` | Values are plain text in source; fine for URLs/env names. Access as `env.MY_VAR`. |
| "call Supabase from a Worker" | `npm install @supabase/supabase-js` + `createClient(env.SUPABASE_URL, env.SUPABASE_KEY)` | Requires `nodejs_compat` flag. Store `SUPABASE_URL` and `SUPABASE_KEY` as secrets via `wrangler secret put`. Instantiate the client inside the handler (not at module level) to keep it request-scoped. |
| "call the Anthropic (Claude) API from a Worker" | `npm install @anthropic-ai/sdk` + `new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })` | Requires `nodejs_compat` flag. Store key as a secret. The SDK uses `fetch` internally — it works with the Workers runtime. For streaming responses, use `stream.toReadableStream()` and return it in the `Response`. |
| "type the env bindings" | Run `npx wrangler types` — generates `worker-configuration.d.ts` with `interface Env { ... }`. Reference it in the handler: `fetch(req: Request, env: Env, ctx: ExecutionContext)` | Re-run after every `wrangler.toml` change. Do not hand-write the `Env` interface — it will drift from config. The generated file is auto-referenced if `tsconfig.json` includes it. |
| "run the Worker locally" | `npx wrangler dev` — serves at `http://localhost:8787` | Reads `.dev.vars` for secrets. Hot-reloads on file save. Use `--remote` flag only if you need live Cloudflare bindings (KV, D1 etc.) — local mode is faster and offline-capable. |
| "deploy the Worker" | `npx wrangler deploy` | Requires `wrangler login` the first time. Deploys to `<name>.workers.dev` by default. Secrets set with `wrangler secret put` are already attached to the deployed worker and don't need re-uploading on deploy. |
| "enable Node.js compat for an SDK" | Add `compatibility_flags = ["nodejs_compat"]` to `wrangler.toml` + set `compatibility_date` to `2024-09-23` or later | With date ≥ 2024-09-23, `nodejs_compat` automatically includes v2 polyfills. Do not use the old `node_compat = true` key — it was removed in Wrangler v4. |
| "run background work after the response" | `ctx.waitUntil(myAsyncFn())` inside the fetch handler | The response is sent immediately; the promise runs for up to 30 seconds after. Use for analytics, cache writes, webhook fire-and-forget. Never `await` work inside `waitUntil` calls — that defeats the purpose. |
| "route requests to different handlers (e.g., POST /tasks)" | Inspect `request.method` and `new URL(request.url).pathname` inside the fetch handler | Workers have one entry point. Build a simple router by hand with `if`/`switch`, or use a micro-router like `itty-router`. No built-in routing. |
| "return JSON from a Worker" | `new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })` | Always set `Content-Type`. `Response` is the Web-standard constructor — no framework needed. |
| "parse a JSON request body" | `const body = await request.json()` inside an `async` handler | `request.body` is a `ReadableStream` — you can only consume it once. Call `.json()`, `.text()`, or `.arrayBuffer()` once and store the result. |

---

## Callback / Lifecycle: The Fetch Handler and ctx

```typescript
// The canonical module-worker shape (TypeScript)
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // env: your typed bindings (secrets, vars, KV, D1, etc.)
    // ctx: execution context — two methods:
    //   ctx.waitUntil(promise)         — run work after response
    //   ctx.passThroughOnException()   — fail-open to origin (avoid this)

    ctx.waitUntil(logToAnalytics(request, env)); // fires after response
    return new Response("ok");
  },
};
```

**Lifecycle guarantees:**
- The `fetch` handler is called once per HTTP request. Return a `Response` to end the request.
- The isolate is yielded after the returned `Promise<Response>` resolves AND all `ctx.waitUntil` promises
  settle (or the 30-second post-response deadline expires).
- `ctx.waitUntil` accepts a single `Promise`. To fire multiple background tasks, wrap them:
  `ctx.waitUntil(Promise.all([task1(), task2()]))`.
- `ctx.passThroughOnException()` makes the Worker silently pass requests to the origin on unhandled
  exceptions. Avoid it — it hides bugs. Use `try/catch` and return structured error responses instead.
- As of August 2025, you can also `import { waitUntil } from 'cloudflare:workers'` to call it from
  deep in your call stack without threading `ctx` everywhere.

> Source: Cloudflare Workers docs — "Context (ctx)", "Fetch Handler", "Directly import waitUntil" changelog
> (2025-08-08) — developers.cloudflare.com/workers (fetched June 2026)

---

## Common Pitfalls

- **Never store per-request data at module scope.** Isolates reuse across requests. A global `let currentUser = null` will leak data between callers. All request state must flow through the handler parameters.
- **Never use `Math.random()` for security-sensitive values.** It is not cryptographically secure. Use `crypto.randomUUID()` or `crypto.getRandomValues()`.
- **Always use timing-safe comparison for secrets.** `===` leaks timing information. Use `crypto.subtle.timingSafeEqual()` after hashing both values to equal-length buffers.
- **Never put secrets in `[vars]`.** They appear as plain text in `wrangler.toml` and in the dashboard. Use `wrangler secret put` for anything sensitive.
- **Never commit `.dev.vars` or `.env`.** Add `.dev.vars*` and `.env*` to `.gitignore`.
- **Always await Promises or pass them to `ctx.waitUntil`.** Floating (unawaited, unregistered) promises are silently dropped by the runtime. Enable the `no-floating-promises` ESLint rule.
- **Always instantiate third-party SDK clients (Supabase, Anthropic) inside the fetch handler**, not at module scope. Module-scope singletons can hold stale state and share mutable state between requests.
- **Never read `request.body` (or call `.json()`, `.text()`, etc.) more than once.** The stream is consumed on first read. Clone with `request.clone()` if you need to read it twice.
- **Never use `XMLHttpRequest`.** It is not supported in the Workers runtime. Use the global `fetch()` API for all outbound HTTP.
- **Always set `Content-Type` on JSON responses.** `new Response(JSON.stringify(x))` without the header returns `text/plain` — callers will silently mis-parse it.
- **Run `wrangler types` after every `wrangler.toml` change.** The generated `worker-configuration.d.ts` drifts from config if you forget.
- **Never use `node_compat = true`** (old boolean) — it was removed in Wrangler v4. Use `compatibility_flags = ["nodejs_compat"]` instead.
- **`@cloudflare/workers-types` vs `@types/jest` conflict in `tsconfig.json`.** If you set `"types": ["@cloudflare/workers-types"]`, Jest globals (`describe`, `it`, `expect`) are not visible — TypeScript errors *"Cannot find name 'describe'"*. Fix: include both: `"types": ["@cloudflare/workers-types", "jest"]`. This means test files see Jest globals globally while source files see CF globals.
- **No Node types in the `workers` package — tests use Web-standard primitives, not `node:*`.** The tsconfig `types` is `["@cloudflare/workers-types", "jest"]` with **no `@types/node`**, so `node:crypto` and `Buffer` fail to type-check even though they'd run under jest's node env. Sign/verify with `crypto.subtle` (HMAC importKey + sign, hex the ArrayBuffer yourself), and base64 with `btoa`/`atob` + `TextEncoder`/`TextDecoder` (loop bytes through `String.fromCodePoint` / `codePointAt` — `unicorn/prefer-code-point` bans `fromCharCode`/`charCodeAt`). This keeps test helpers identical to the runtime the Worker actually targets. Also note `crypto.subtle.timingSafeEqual` is a **Workers-only** extension absent from Node's Web Crypto — hand-roll a constant-time compare so it runs in both.
- **Secret-only `Env` is hand-written, not generated.** `wrangler types` only emits types for `wrangler.toml` **bindings** — secrets set via `wrangler secret put` are invisible to it. So declare an `export interface Env { … }` of your secrets by hand in `src/index.ts` (the "don't hand-write Env" guidance applies to *binding* drift, which doesn't exist for secrets). `unicorn/no-null` is also on here — return/compare `undefined`, never `null`, in Worker source.
- **`worker.fetch` is optional on `ExportedHandler`.** The TypeScript type for `ExportedHandler<Env>` makes the `fetch` property optional (can be `undefined`). In tests, you must null-check before calling it: `const fetch = worker.fetch; if (!fetch) throw new Error(...)`. Alternatively, type the module's default export as the handler function directly.
- **Casting `new Request(...)` in unit tests.** The standard Web API `Request` constructor produces a `Request<unknown, CfProperties<unknown>>`, but `ExportedHandler.fetch` expects `Request<unknown, IncomingRequestCfProperties<unknown>>`. These are incompatible under `exactOptionalPropertyTypes: true`. Cast with `new Request(url) as unknown as Parameters<typeof fetch>[0]` — this is type-safe for unit tests since the CF-specific fields aren't used.
- **Avoid `async fetch()` when there is no `await`.** `@typescript-eslint/require-await` fires on an `async` function with no `await` expression. If your fetch handler is synchronous, declare it as `fetch(): Response { ... }` — the `ExportedHandler` type accepts both sync and async.
- **`ExportedHandler` fetch signature allows omitting unused parameters.** In TypeScript, you may omit trailing unused parameters: `fetch(): Response` is valid when the handler doesn't need `request`, `env`, or `ctx` — the cleanest option, since there's no placeholder to read past. When a param *can't* be dropped because a later one is used (e.g. `fetch(_request, env)`), prefix the unused one with `_`: the project's ESLint config sets `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: '^_'` (matching TypeScript's `noUnusedParameters`, which already exempts `_`-prefixed params). So `_`-prefix is no longer a "workaround" — it's the supported convention; reach for it whenever a fixed signature forces an unused leading param.

---

## Version Gotchas (as of Wrangler v4, March 2025)

- **Service-worker syntax is legacy.** `addEventListener('fetch', event => { event.respondWith(...) })` still runs but is deprecated. Agents trained before ~2022 will generate this pattern. Always use `export default { async fetch(request, env, ctx) { ... } }`.
- **`wrangler publish` was removed in Wrangler v4.** Use `wrangler deploy`.
- **`node_compat = true` was removed in Wrangler v4.** Use `compatibility_flags = ["nodejs_compat"]`.
- **`wrangler generate` was removed.** Use `npm create cloudflare@latest`.
- **`getBindingsProxy()` was removed.** Use `getPlatformProxy()` for testing bindings in non-Worker environments.
- **`wrangler dev` now defaults to local mode in v4.** In v3 it defaulted to remote. Add `--remote` if you need live Cloudflare bindings during dev.
- **KV and R2 CLI commands now default to local in v4.** Add `--remote` to query production data.
- **`nodejs_compat` v2 is automatic with `compatibility_date >= 2024-09-23`.** You do not need to separately specify `nodejs_compat_v2` — specifying `nodejs_compat` is sufficient when the date is current.
- **`wrangler.jsonc` is the new scaffold default.** `npm create cloudflare@latest` generates `wrangler.jsonc`. Existing projects likely have `wrangler.toml`. Both work. Do not mix them in the same project (Wrangler reads only one).

> Sources: Cloudflare Workers docs — "Migrate from Wrangler v3 to v4" (2025-03-13), "Use the latest JavaScript
> features with Wrangler CLI v4" changelog — developers.cloudflare.com/workers (fetched June 2026)

---

## Canonical File Layout (alfred workers/ context)

```
workers/
  my-worker/
    src/
      index.ts          ← Worker entrypoint (export default { fetch })
    wrangler.toml        ← or wrangler.jsonc
    worker-configuration.d.ts  ← generated by `wrangler types` (do not hand-edit)
    tsconfig.json
    package.json
    .dev.vars            ← local secrets (gitignored)
```

**Minimal `wrangler.toml`** for the alfred LLM-gateway Worker:

```toml
name = "alfred-llm-gateway"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[vars]
ENVIRONMENT = "production"

# Secrets (declared for documentation; values set via `wrangler secret put`):
# ANTHROPIC_API_KEY
# SUPABASE_URL
# SUPABASE_KEY
# ALFRED_API_KEY   ← the key callers must present
```

**Minimal TypeScript entrypoint** for the alfred LLM-gateway pattern:

```typescript
// src/index.ts
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

// Env is generated by `wrangler types` into worker-configuration.d.ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 1. Validate caller API key
    const authHeader = request.headers.get("Authorization") ?? "";
    const provided = authHeader.replace(/^Bearer\s+/i, "");
    if (!(await timingSafeEqual(provided, env.ALFRED_API_KEY))) {
      return new Response("Unauthorized", { status: 401 });
    }

    // 2. Parse request
    const body = await request.json<{ prompt: string }>();

    // 3. Call LLM
    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: body.prompt }],
    });

    // 4. (Optional) persist to Supabase
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
    ctx.waitUntil(
      supabase.from("llm_calls").insert({ prompt: body.prompt, response: message.content })
    );

    // 5. Return result
    return new Response(JSON.stringify(message.content), {
      headers: { "Content-Type": "application/json" },
    });
  },
};

// Timing-safe string comparison using Web Crypto
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ka, kb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ka, kb);
}
```

> Note: The Anthropic model ID in the example above (`claude-opus-4-5`) should be verified against the
> claude-api skill before use — model IDs change. See `/home/user/alfred/.claude/skills/` for the
> `claude-api` skill.

---

## What Was Deliberately Left Out (and Why)

- **Durable Objects** — stateful objects with their own storage; not needed for the alfred MVP. Would require a separate entrypoint class extending `DurableObject`.
- **KV / R2 / D1 bindings** — alfred uses Supabase as its database; native Cloudflare storage bindings are out of scope.
- **Cloudflare Queues / Workflows** — useful for durable async work; out of scope for the MVP LLM-gateway pattern.
- **Service bindings (Worker-to-Worker RPC)** — zero-cost inter-Worker calls; not relevant until alfred has multiple Workers that call each other.
- **Wrangler environments (`[env.staging]`)** — multi-environment config; left out to keep the skill focused. Note that vars and secrets are non-inheritable in environments — you must redeclare them per environment block.
- **Cron triggers / scheduled handler** — the `scheduled(event, env, ctx)` export; out of scope for the HTTP gateway use case.
- **`@cloudflare/vitest-pool-workers` testing** — runs tests inside the real Workers runtime; left out to keep scope tight. Highly recommended for production but is a separate topic.
- **Streaming LLM responses back to the client** — the pattern (return `new Response(stream.toReadableStream())`) works but was excluded to keep the example simple and focused on the validate-call-persist shape.
- **Hyperdrive** — connection pooling for Postgres; alfred uses Supabase's HTTP client, not a raw Postgres connection, so Hyperdrive doesn't apply.
