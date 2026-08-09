---
name: anthropic-api
description: >
  Covers the Anthropic Claude API: the Messages API, structured outputs
  (output_config.format), defining tools, the tool-use agentic loop, streaming, model ids,
  and calling Claude from a Cloudflare Worker (SDK vs raw fetch, stop_reason). Use when
  writing or debugging any of those, or on any mention of anthropic, @anthropic-ai/sdk,
  claude-*, output_config, json_schema, tool_use, tool_result, or stop_reason — including
  "classify text with Claude", "get JSON back in a fixed shape", or "run the tool loop".
  For the Worker runtime, bindings and wrangler config, use the cloudflare-workers skill.
---

# Anthropic API Skill (alfred project)

**Context:** alfred calls the Anthropic API from inside a Cloudflare Worker, and today the
live path is Inbox triage: a scheduled sweep asks a small model to classify each captured
item and writes the answer straight onto the item's real fields. That shape — one item, one
stateless request, a schema-constrained answer — is what the skill is built around;
structured outputs are the centerpiece, and the tool-use material below is for the
agentic paths alfred has not built yet.

Sources: Anthropic platform docs (platform.claude.com).

---

## Mental Model

The Messages API is **stateless**: every call sends the *complete* conversation
history. There is no session — you own the message array and grow it yourself on
each turn.

Everything the model produces is a **content block** — never bare text. A response
`content` array can contain `text` blocks (prose), `tool_use` blocks (a structured
call the model is requesting), and potentially mixed combinations of both. Your code
must iterate blocks and dispatch by `type`, not assume a single string response.

**Structured output and tool use are different jobs.** If you want the *response itself*
in a fixed shape, that is `output_config.format` — a JSON Schema that constrains
generation, so an out-of-enum value is not something the model can emit rather than
something you catch afterwards. Tools are for the model *asking your code to do
something*. Reaching for a single forced tool as a JSON-shaping trick is the older
pattern and is no longer the right answer.

**Tool use is a contract, not a magic feature.** You provide a JSON Schema describing
what your tools accept; the model emits a structured `tool_use` block requesting a
call; your code executes it and sends back a `tool_result` block; the model continues.
The model *never* executes anything — it only emits structured requests. Every tool
call is a round-trip.

**The tool-use loop exits on `stop_reason`.** Valid values: `"end_turn"` (done),
`"tool_use"` (you must run tools and send results back), `"max_tokens"` (hit token
limit), `"stop_sequence"` (hit a custom stop), `"refusal"` (model declined),
`"pause_turn"` (only for server-side tools — resume by re-sending the conversation).
Loop while `stop_reason === "tool_use"`; exit on everything else.

**The `tool_use_id` is the contract identifier.** The model's `tool_use` block
contains an `id` field (e.g. `"toolu_01A09q90…"`). Your `tool_result` block must
echo that exact value in `tool_use_id`. Mismatches cause 400 errors.

Source: Anthropic, "How tool use works" and "Handle tool calls", platform.claude.com, June 2026.

---

## Decision Tree

**Which client: `@anthropic-ai/sdk` or raw `fetch`?**

- Cloudflare Workers with `nodejs_compat` flag → SDK works and is preferred; add
  `compatibility_flags = ["nodejs_compat"]` to `wrangler.toml`.
- Workers without `nodejs_compat`, or when minimizing bundle size → raw `fetch` is
  fine and avoids the dependency. The raw API is straightforward (two headers, one
  JSON body).
- Both approaches are valid in alfred's Workers context; this skill covers both.

**Streaming or not?**

- Cleaning/classifying a short voice capture → non-streaming is simpler; latency is
  acceptable.
- Pre-filling a UI with text as it arrives, or `max_tokens` is large (> ~4k) → use
  streaming to avoid HTTP timeouts; the SDK auto-streams large requests.
- Tool-use loops rarely benefit from streaming unless you need incremental input JSON.

**How do I get JSON back in a shape I can trust?**

- The response *is* the data (classification, extraction) → `output_config.format` with a
  `json_schema`. See *Structured outputs* below.
- The model needs to *call your code* → tools, with `tool_choice: { type: "auto" }` (or
  `"any"` to force one of N, `{ type: "tool", name }` to force a specific one). Add
  `strict: true` on the tool definition when the parameters must validate exactly.
- Note: `tool_choice: "any"` and `tool_choice: "tool"` suppress natural-language
  preamble; the response content array starts directly with the `tool_use` block.

---

## Structured outputs (`output_config.format`)

```typescript
const message = await client.messages.create({
  model: env.CLASSIFIER_MODEL,
  max_tokens: 512,
  system: systemPrompt,
  messages: [{ role: "user", content: itemText }],
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        additionalProperties: false,            // required by structured outputs
        required: ["item_type", "folder_id"],   // list EVERY key
        properties: {
          item_type: { anyOf: [{ enum: ["task", "code"] }, { type: "null" }] },
          folder_id: { anyOf: [{ enum: liveFolderIds }, { type: "null" }] },
        },
      },
    },
  },
});
```

- **`additionalProperties: false` is mandatory**, and every key belongs in `required`. A
  nullable field is an explicit `{ "type": "null" }` branch, never an omitted key — abstention
  has to be a value the model can *emit*.
- **Put real ids in the `enum`, not `{ type: "string" }`.** That is the whole payoff: a
  hallucinated id stops being a case your code has to handle. Re-validate anyway — the enum
  closes the value space at generation time but not the *time gap*, since a row can be deleted
  between assembling the prompt and writing the answer back.
- **An empty `enum` is not a valid schema.** When the live list is empty (a fresh database with
  no folders), collapse the field to bare `{ "type": "null" }`.
- **`messages.parse()` is not usable with a per-request schema** — it wants a static Zod schema.
  With a schema rebuilt per call, read the JSON out of the single `text` block yourself and
  `JSON.parse` it, guarding `stop_reason` first.
- **Cost:** a new schema pays a one-time compilation and then caches for 24 hours, so a schema
  whose only variable is a rarely-changing id list is effectively stable. Not a reason to hand
  the model a free-text field.
- Incompatible with citations and with assistant prefill.

Source: Anthropic, "Structured outputs", platform.claude.com.

---

## Plain-English → Pattern Table

| When you want to… | Use this pattern | Key things to know |
|---|---|---|
| **Call the API from a Cloudflare Worker** | Raw `fetch` to `https://api.anthropic.com/v1/messages` with `x-api-key` from `env.ANTHROPIC_API_KEY` (Worker secret) and `anthropic-version: 2023-06-01` | Never hardcode the key; bind it as a Worker secret in `wrangler.toml` via `[vars]` or the dashboard. Two headers are mandatory: `x-api-key` and `anthropic-version`. |
| **Call the API with the SDK in a Worker** | `npm install @anthropic-ai/sdk`; add `compatibility_flags = ["nodejs_compat"]` to `wrangler.toml`; instantiate `new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })` inside the `fetch` handler | The SDK is officially supported on Cloudflare Workers with `nodejs_compat`. Access `env` in the Worker's `fetch(request, env)` handler — don't use `process.env` in Workers. |
| **Classify captured text into task / code / knowledge** | System prompt describing the categories + `output_config.format` with a `json_schema` whose fields are enums | The enum constrains generation, so an out-of-range category is impossible rather than caught. See *Structured outputs* above. |
| **Define a create-item tool** | Tool object: `{ name, description, input_schema: { type: "object", properties: {...}, required: [...] } }` — passed in the top-level `tools` array | `name` must match `^[a-zA-Z0-9_-]{1,64}$`. Write 3–4 sentence descriptions — this is the single biggest factor in tool reliability. |
| **Run the tool-use loop until done** | `while (response.stop_reason === "tool_use")` → extract `tool_use` blocks → execute → push assistant response + user `tool_result` message → call API again | The assistant's full response (including any text blocks alongside `tool_use` blocks) must be appended to messages before the `tool_result` user message. Both go in the same `messages.push()` sequence. |
| **Send a tool result back** | User-role message: `{ role: "user", content: [{ type: "tool_result", tool_use_id: block.id, content: "..." }] }` | `tool_use_id` must match the `id` from the assistant's `tool_use` block exactly. `tool_result` blocks must come *first* in the user content array — any additional text must follow them, not precede. |
| **Signal a tool execution error** | Same `tool_result` structure, add `"is_error": true` and put the error message in `content` | Claude will attempt to recover or inform the user. Write informative errors (e.g., "DB write failed: unique constraint on item_id") not generic ones — Claude uses the message to decide next steps. |
| **Force the model to call a specific tool** | `tool_choice: { type: "tool", name: "create_item" }` in the request | Suppresses prose preamble. If you also want schema validation, set `strict: true` on the tool definition. |
| **Get structured JSON output (no round-trip)** | `output_config: { format: { type: "json_schema", schema } }`; read the JSON out of the single `text` block | The pattern for classification and extraction. Guard `stop_reason` before touching `content`. See *Structured outputs* above. |
| **Stream the response** | SDK: `client.messages.stream({...}).on("text", cb)` or `for await (const event of stream)`; fetch: `"stream": true` in body, parse SSE lines | SSE event flow: `message_start` → `content_block_start` → N×`content_block_delta` → `content_block_stop` → `message_delta` (has final `stop_reason`) → `message_stop`. For tool use in streams, `input_json_delta` events carry partial JSON — accumulate and parse at `content_block_stop`. |
| **Use the SDK with full TypeScript types** | `import Anthropic from "@anthropic-ai/sdk"` — all params and responses are typed via `Anthropic.MessageCreateParams`, `Anthropic.Message`, `Anthropic.ToolUseBlock`, etc. | The SDK auto-sends `anthropic-version: 2023-06-01`. To override, pass `headers` in the request options — but this may cause type mismatches. |
| **Prompt for text cleanup (no tools)** | `system` field for instructions + single `user` message with the raw voice text; read `response.content[0].text` | Keep `max_tokens` proportional to expected output. For short cleanups, 512–1024 is sufficient. `temperature`/`top_p`/`top_k` are removed on current models and return a 400 — steer with the prompt. |
| **Pick a model** | `claude-haiku-4-5` for high-volume, latency-sensitive classification; `claude-sonnet-5` for the speed/quality balance; `claude-opus-5` for complex multi-step reasoning | See Version Gotchas for exact IDs and prices. Never hard-code the id in a Worker — make it a `[vars]` entry so changing it is a deploy flag. At alfred's volumes every tier is inside noise, so pick by *fit* (does it support the feature you need?), not by price. |

Source: Anthropic platform docs (platform.claude.com), fetched June 2026.

---

## Callback / Lifecycle: The Agentic Tool-Use Loop

The loop has one invariant: **the `messages` array is the complete truth**. Every
turn appends to it; nothing is ever removed.

```
Loop iteration N:
  1. POST /v1/messages  { messages, tools, system, model, max_tokens }
  2. response.stop_reason === "tool_use"  →  continue
     response.stop_reason === "end_turn"  →  done; read response.content for text
     anything else (max_tokens, refusal)  →  handle as error/edge case

  3. For each block in response.content where block.type === "tool_use":
       result = await executeLocally(block.name, block.input)
       toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result })

  4. messages.push(
       { role: "assistant", content: response.content },  // the FULL assistant turn
       { role: "user",      content: toolResults }         // all tool results together
     )

  5. Repeat from step 1
```

**Pairing rule:** The assistant message (step 4 left) and the user message with tool
results (step 4 right) must be pushed in sequence — and the user message must
immediately follow the assistant message with no intervening turns.

**Parallel tool calls:** The model may emit multiple `tool_use` blocks in one turn.
Execute them (in parallel if safe), collect all results into a single `tool_result`
array, and send them in one user message. Do not send one user message per result.

**Loop guard:** Set a maximum iteration count (e.g., 10). If the loop exhausts its
budget before `stop_reason === "end_turn"`, surface the partial state rather than
spinning indefinitely.

Source: Anthropic, "How tool use works — The agentic loop" and "Handle tool calls",
platform.claude.com, June 2026.

---

## Common Pitfalls

**Always include `anthropic-version: 2023-06-01` when using raw fetch.** Omitting
it returns a 400. The SDK sends it automatically.

**Never use `process.env` in Cloudflare Workers.** Access the API key via the Worker
`env` parameter: `fetch(request, env, ctx)` → `env.ANTHROPIC_API_KEY`.

**Always append the full assistant response to messages before tool results.** If you
only append the `tool_use` blocks and discard any `text` blocks, the conversation
history is corrupt and subsequent calls will error or behave unpredictably.

**Never put text before `tool_result` blocks in a user message content array.** The
API requires `tool_result` blocks to appear first. Text may follow, not precede.

**Never reuse a `tool_use_id`.** Each tool call in each turn has a unique `id`.
Copy it exactly into `tool_use_id` of the matching result — don't generate your own.

**Always match `tool_use_id` to the exact `id` from the assistant block.** Even a
single character difference causes a 400 error: "tool_use ids were found without
tool_result blocks immediately after".

**Never set `temperature`, `top_p`, or `top_k` on a current Opus or Sonnet model.**
They are removed from the 4.6-and-later Opus/Sonnet line and return a 400. Use
prompting to guide behavior instead. (They remain valid on Haiku 4.5.)

**Never use prefill (a trailing assistant message) on a current Opus or Sonnet model.**
It returns a 400. Use `output_config.format` instead.

**Never send `output_config.effort` to Haiku 4.5.** It rejects the parameter outright.
A classification task needs no reasoning budget anyway, so omit it — a copied-in
`effort` from an Opus example is the failure mode to watch for.

**Haiku 4.5's minimum cacheable prefix is 4096 tokens**, so a compact prompt silently
never caches: `cache_read_input_tokens: 0` is the expected reading, not a bug. Never pad
a prompt to reach the floor — crossing it only makes caching *possible*, and a write
costs 1.25× against a read's 0.1×, so it loses money unless several calls share the
prefix inside the TTL.

**Always write 3–4 sentence tool descriptions.** A one-line description is the
single most common cause of tools being called at the wrong time or with wrong
inputs. Describe what it does, when to use it, what it returns, and edge cases.

**Never send tool results for server-executed tools** (`web_search`, `code_execution`,
`web_fetch`). Anthropic runs those — their results arrive in `server_tool_use` blocks
already resolved. Only construct `tool_result` for user-defined (client) tools.

Source: Anthropic, "Handle tool calls", "Define tools", "Messages API — Basic request",
platform.claude.com, June 2026; Anthropic, "Models overview", platform.claude.com, June 2026.

---

## Version Gotchas (as of Claude 4.x, June 2026)

**Model IDs no longer contain dates** for the 4.6 generation and later. They are
pinned snapshots despite lacking a date suffix. Do not append a date: `claude-sonnet-4-6`
is correct; `claude-sonnet-4-6-20250101` does not exist.

**Current models:**
- `claude-opus-5` — complex multi-step reasoning, 1M context, 128k output, $5/$25 per MTok
- `claude-sonnet-5` — speed/quality balance, 1M context, 128k output, $3/$15
- `claude-haiku-4-5` (alias) or `claude-haiku-4-5-20251001` (pinned) — fastest, 200k context,
  64k output, $1/$5. Supports structured outputs; rejects `effort`.

Model ids and prices move faster than this file. Look them up against the bundled `claude-api`
skill (or the Models API) rather than from memory before writing one into code.

**`temperature`/`top_p`/`top_k` removed on the current Opus/Sonnet line.** Agents trained
on older patterns will include these; any value other than the default returns 400.

**Prefill blocked on the current Opus/Sonnet line.** Ending `messages` with a partial
`assistant` turn to steer output no longer works. Use `output_config.format` instead.

**SDK Cloudflare Workers support is now official** — Cloudflare Workers is listed
as a supported runtime in the TypeScript SDK docs. The `nodejs_compat` flag requirement
is confirmed (add `compatibility_flags = ["nodejs_compat"]` to `wrangler.toml`).
Prior to mid-2025 this was unofficial and fragile (see GitHub issue #392).

**`stop_reason: "refusal"` is new** on Claude 4.x — it was not present in earlier
Claude 3 responses. Check for it in your loop exit condition alongside `"end_turn"`,
`"max_tokens"`, and `"stop_sequence"`.

Source: Anthropic, "Models overview", "Migration guide", platform.claude.com, June 2026;
GitHub anthropics/anthropic-sdk-typescript, issue #392.

---

## What Was Deliberately Left Out

- **Batch API (`/v1/messages/batches`)** — async bulk processing; not relevant to
  alfred's synchronous Worker use case.
- **Server-executed tools** (`web_search`, `web_fetch`, `code_execution`) — Anthropic
  runs these; alfred's tools are all user-defined client tools against Supabase.
- **Extended thinking / `effort` parameter** — advanced reasoning mode; not needed
  for text cleanup and item classification at alfred's scope.
- **Prompt caching (`cache_control`)** — alfred's live prompts sit below their model's
  minimum cacheable prefix, so there is nothing to cache; see the pitfall above before
  reaching for it.
- **Vision / image blocks** — alfred is text-only for item capture; image content
  blocks excluded to keep the skill focused.
- **Files API** — for uploading persistent documents; not part of alfred's use case.
- **Amazon Bedrock / Vertex AI clients** — alfred calls the Anthropic API directly;
  the Bedrock/Vertex SDK wrappers are excluded.
- **MCP helpers (`mcpTools`, `mcpMessages`)** — alfred does not use MCP servers.
- **`tool_choice: "any"` with extended thinking** — unsupported combination; excluded
  to avoid an agent reaching for it.
- **Fine-grained tool streaming** (`input_json_delta` accumulation in streaming) —
  relevant only if alfred surfaces live tool input to the UI; excluded until needed.
