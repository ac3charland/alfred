/**
 * The Worker's one narrow window onto the Anthropic API — the only module allowed to import
 * `@anthropic-ai/sdk`, so swapping providers later touches this file and nothing else.
 *
 * Two exports, one call. `classifyJson` sends an already-built prompt and hands back whatever
 * JSON came back or a typed `ClassifyFailure` — it knows nothing about what is being judged, so
 * both classifiers in this Worker share one retry policy and one error taxonomy. `classify` is
 * the Inbox's reading of that answer as a `Verdict`. Neither ever throws: a sweep calls this once
 * per eligible row, and an unhandled rejection would abort every row queued behind it.
 */
import Anthropic from '@anthropic-ai/sdk';

import type { ClassifyRequest } from './prompt';
import { type ClassifyFailure, type ClassifyOutcome, parseVerdict } from './verdict';

/** The bindings this module reads. The key is a Cloudflare SECRET and lives only here. */
export interface ClassifierEnv {
  ANTHROPIC_API_KEY?: string;
  CLASSIFIER_MODEL: string;
}

/** Headroom over the ~100-token verdict, so a truncation is a config bug and not routine. */
export const MAX_TOKENS = 512;

/**
 * Per-request budget, and one retry rather than the SDK's two. The default is a ten-MINUTE
 * timeout, which a sweep cannot afford: ten items held that long run a single tick far past the
 * two-minute cron cadence, and Cloudflare does not serialize scheduled invocations — so a slow
 * tick is how two sweeps come to be classifying the same rows at once.
 *
 * Sized against the schedule rather than picked round: a full sweep of maximally slow requests is
 * 10 × 10s × 2 attempts ≈ 200s, under two cadences, so at most one earlier tick can still be in
 * flight when the next begins and a third can never pile on behind them. `sweep.ts` pins that
 * arithmetic in a test, and its conditional write makes the one permitted overlap harmless.
 *
 * 10s is ample for a ~100-token verdict from Haiku while still leaving the retry room to absorb a
 * blip inside the request, which is what keeps a transient 429 from reaching the attempt counter.
 */
export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_RETRIES = 1;

/** A short, log-friendly rendering of a thrown value — `Error#message` when there is one. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The first `text` block in a response's content, or absent if the model returned none. */
function textBlock(message: Anthropic.Message): Anthropic.TextBlock | undefined {
  return message.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
}

/**
 * Turn a successful response into JSON, or into the one failure reason that covers every way it
 * can fail to be JSON — no text block, or a body that doesn't parse. Called only once
 * `stop_reason` has ruled out `refusal` and `max_tokens`, and neither case here is worth a retry.
 */
function readJson(message: Anthropic.Message): JsonOutcome {
  const block = textBlock(message);
  if (block === undefined) {
    return { failed: { reason: 'unparseable', detail: 'response has no text block' } };
  }

  try {
    return { ok: JSON.parse(block.text) as unknown };
  } catch {
    return {
      failed: { reason: 'unparseable', detail: `not valid JSON: ${block.text.slice(0, 200)}` },
    };
  }
}

/** One call's parsed JSON body, or one typed reason there isn't one. */
export type JsonOutcome = { ok: unknown } | { failed: ClassifyFailure };

/**
 * Send one request and return whatever JSON came back, or a typed failure. Never throws.
 *
 * The provider-agnostic half of this module, and the one both classifiers share: the SDK call,
 * the error taxonomy and the `stop_reason` guards are identical whatever is being judged, while
 * the SHAPE of a verdict is not — the Inbox answers with six nullable fields, Comms with a tier
 * and an ask. Rather than fork the call per shape, the caller supplies the schema and reads its
 * own answer out of the JSON, which is what keeps the retry policy and the failure reasons in
 * exactly one place.
 *
 * The client is built fresh on every call rather than hoisted to module scope: a Worker isolate
 * is reused across invocations, and a module-scope singleton would carry state — and a stale
 * `env` — between them.
 */
export async function classifyJson(
  env: ClassifierEnv,
  request: ClassifyRequest,
): Promise<JsonOutcome> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (apiKey === undefined) {
    return { failed: { reason: 'credentials', detail: 'ANTHROPIC_API_KEY is not set' } };
  }

  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES });

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: env.CLASSIFIER_MODEL,
      max_tokens: MAX_TOKENS,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
      // Structured outputs: the schema is rebuilt per sweep from live folder/project/epic ids,
      // so `messages.parse()` — which wants a schema fixed at call-site — doesn't fit here. Read
      // the JSON out of the text block by hand instead.
      output_config: { format: { type: 'json_schema', schema: request.schema } },
    });
  } catch (error) {
    // A missing or rejected credential is a fault of the deploy, not the item: the caller aborts
    // the whole tick on this reason rather than burning an attempt on every eligible row.
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      return { failed: { reason: 'credentials', detail: describe(error) } };
    }
    // A 400 is the deploy's fault too, and separated from transport for the same reason: the
    // request shape and the model id are identical for every item, so if the API rejects one it
    // rejects all ten, every tick, until someone changes the code. Counting that as a per-item
    // failure is what would opt the whole Inbox out inside ten minutes.
    if (error instanceof Anthropic.BadRequestError) {
      return { failed: { reason: 'bad_request', detail: describe(error) } };
    }
    // Everything else — 429, 5xx, a timeout, a raw network failure — after the client's own
    // retries have already run their course.
    return { failed: { reason: 'transport', detail: describe(error) } };
  }

  // Guard `stop_reason` before touching `content`: a refusal or truncation carries no usable
  // verdict, and re-sending the identical prompt after a refusal will not change the model's mind.
  if (message.stop_reason === 'refusal') {
    return { failed: { reason: 'refusal' } };
  }
  if (message.stop_reason === 'max_tokens') {
    return { failed: { reason: 'truncated' } };
  }

  return readJson(message);
}

/**
 * The Inbox classifier's call: one item's request in, a shape-checked `Verdict` out. A body that
 * parsed as JSON but isn't a verdict object joins the other unparseable answers — the schema
 * makes every key required, so a response that doesn't shape-check is a structured-output
 * failure, and re-sending the identical prompt is not the fix.
 */
export async function classify(
  env: ClassifierEnv,
  request: ClassifyRequest,
): Promise<ClassifyOutcome> {
  const outcome = await classifyJson(env, request);
  if ('failed' in outcome) return outcome;

  const verdict = parseVerdict(outcome.ok);
  if (verdict === undefined) {
    return {
      failed: {
        reason: 'unparseable',
        detail: `not a JSON object: ${JSON.stringify(outcome.ok).slice(0, 200)}`,
      },
    };
  }
  return { ok: verdict };
}
