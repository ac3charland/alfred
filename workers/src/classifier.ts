/**
 * The Worker's one narrow window onto the Anthropic API — the only module allowed to import
 * `@anthropic-ai/sdk`, so swapping providers later touches this file and nothing else. `classify`
 * sends one item's already-built prompt and returns either a parsed `Verdict` or a typed
 * `ClassifyFailure`; it never throws, because the sweep calls this once per eligible item and an
 * unhandled rejection would abort every item still queued behind it in the same tick.
 */
import Anthropic from '@anthropic-ai/sdk';

import type { ClassifyRequest } from './prompt';
import { type ClassifyOutcome, parseVerdict } from './verdict';

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
 * Turn a successful response into an outcome. Called only once `stop_reason` has already ruled
 * out `refusal` and `max_tokens`, so everything that can still go wrong here — no text block, a
 * body that isn't JSON, a body that doesn't shape-check — is folded into one `unparseable` reason;
 * none of them is worth a retry on its own.
 */
function readVerdict(message: Anthropic.Message): ClassifyOutcome {
  const block = textBlock(message);
  if (block === undefined) {
    return { failed: { reason: 'unparseable', detail: 'response has no text block' } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return {
      failed: { reason: 'unparseable', detail: `not valid JSON: ${block.text.slice(0, 200)}` },
    };
  }

  const verdict = parseVerdict(parsed);
  if (verdict === undefined) {
    return {
      failed: { reason: 'unparseable', detail: `not a JSON object: ${block.text.slice(0, 200)}` },
    };
  }
  return { ok: verdict };
}

/**
 * Send one item's request and return a parsed verdict or a typed failure. Never throws.
 *
 * The client is built fresh on every call rather than hoisted to module scope: a Worker isolate
 * is reused across invocations, and a module-scope singleton would carry state — and a stale
 * `env` — between them.
 */
export async function classify(
  env: ClassifierEnv,
  request: ClassifyRequest,
): Promise<ClassifyOutcome> {
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

  return readVerdict(message);
}
