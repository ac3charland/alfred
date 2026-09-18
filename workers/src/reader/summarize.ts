/**
 * One post in, one summary or one typed reason there isn't one. The Reader's only window onto the
 * Anthropic API.
 *
 * This module deliberately DUPLICATES the twenty lines of stop-reason and error mapping that
 * `classifier.ts` carries rather than importing them. The two are not the same call and must not
 * become coupled: the classifier sends a per-sweep schema to Haiku with no thinking key and no
 * effort, while this sends a fixed schema to Sonnet with `thinking: { type: 'disabled' }` and
 * `effort: 'medium'` — a combination Haiku rejects outright. Sharing the call would mean one
 * module growing flags for the other's model, and the first flag would be the last honest moment.
 * The taxonomy is shared by CONVENTION; the code is not.
 *
 * Nothing here throws. The tick calls it once per post inside a loop, and an unhandled rejection
 * would abandon every post queued behind this one — along with the lease rows they are holding.
 */
import Anthropic from '@anthropic-ai/sdk';

import { buildReaderRequest } from './prompt';
import { isReaderSummary, normalizeReaderSummary } from './schema';
import type { SummaryConfig, SummaryInput, SummaryOutcome, SummaryUsage } from './types';

/**
 * Headroom over the ~1 500-token summary the schema asks for. Generous on purpose: `max_tokens` is
 * a COUNTED failure, so a ceiling set to the typical answer would spend three attempts and then
 * fail a long post permanently for being long.
 */
export const READER_MAX_TOKENS = 4096;

/**
 * Per-request budget, and one retry rather than the SDK's two.
 *
 * The classifier's 10 s fits a ~100-token verdict; ~1 500 output tokens from Sonnet 5 takes
 * 15–40 s, so 10 s here would time out routinely and file every post as a transport failure. 60 s
 * is sized against the tick instead: the worst post costs 60 s × 2 attempts, six of them plus the
 * Gmail reads is ~12.5 minutes against a 15-minute wall clock, which is why the tick carries its
 * own eight-minute budget on top. The SDK's timeout is MILLISECONDS in TypeScript.
 */
export const READER_REQUEST_TIMEOUT_MS = 60_000;
export const READER_MAX_RETRIES = 1;

/** A short, log-friendly rendering of a thrown value — `Error#message` when there is one. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The first `text` block in a response's content, or absent if the model returned none. */
function textBlock(message: Anthropic.Message): Anthropic.TextBlock | undefined {
  return message.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
}

/**
 * The token counts, for the eval script's cost line and nothing else.
 *
 * Takes the value rather than the message, and declares it possibly absent although the SDK types
 * `usage` as required. A parameter is the only place that annotation survives: on a `const` the
 * compiler narrows straight back to the assigned type and the undefined branch is then flagged as
 * dead code. The branch is not dead — a stubbed or future response may carry no usage, and a
 * missing cost line is not worth throwing away a summary that arrived.
 */
function readUsage(usage: Anthropic.Usage | undefined): SummaryUsage | undefined {
  if (usage === undefined) return undefined;
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
}

/**
 * `usage` as a spreadable fragment. `SummaryOutcome` declares the key optional WITHOUT
 * `| undefined`, so under `exactOptionalPropertyTypes` writing `{ usage }` with a possibly-absent
 * value is an error — the key has to be omitted rather than set to nothing.
 */
function usageFields(usage: SummaryUsage | undefined): { usage?: SummaryUsage } {
  return usage === undefined ? {} : { usage };
}

/**
 * Summarise one post. Never throws; every failure is one of the five `SummaryOutcome` kinds, and
 * which kind it is decides what the tick does next:
 *
 * - `systemic` — the deploy is wrong for EVERY post, so the tick stops rather than burning an
 *   attempt on each row in turn.
 * - `counted` — content-shaped, charged against the row's three attempts.
 * - `uncounted` — a 429, a 5xx, a timeout, a network blip; the row stays pending and rides the
 *   next tick with its attempt count untouched.
 * - `refused` / `done` — terminal.
 *
 * The client is built per call rather than hoisted to module scope: a Worker isolate is reused
 * across invocations, and a singleton would carry a stale key between them.
 */
export async function summarizePost(
  post: SummaryInput,
  config: SummaryConfig,
): Promise<SummaryOutcome> {
  const apiKey = config.apiKey;
  if (apiKey === '') {
    return { kind: 'systemic', reason: 'credentials', error: 'ANTHROPIC_API_KEY is not set' };
  }

  const request = buildReaderRequest(post);
  const client = new Anthropic({
    apiKey,
    timeout: READER_REQUEST_TIMEOUT_MS,
    maxRetries: READER_MAX_RETRIES,
  });

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: config.model,
      max_tokens: READER_MAX_TOKENS,
      // Sonnet 5 runs ADAPTIVE thinking when this key is omitted — billed as output and
      // counted against max_tokens, which is exactly the silent truncation this call must not
      // have. The classifier gets away with omitting it only because Haiku never thinks unasked.
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: request.schema },
      },
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
    });
  } catch (error) {
    // A missing or rejected credential is the deploy's fault, not the post's: the tick ends on
    // this rather than spending the daily ceiling discovering the same 401 six times.
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      return { kind: 'systemic', reason: 'credentials', error: describe(error) };
    }
    // A 400 is the deploy's fault too, and for a sharper reason: the request shape and the model
    // id are identical for every post, so a rejection of one is a rejection of all of them, every
    // tick, until someone changes the code. Counted per-post it would fail the whole backlog.
    if (error instanceof Anthropic.BadRequestError) {
      return { kind: 'systemic', reason: 'bad_request', error: describe(error) };
    }
    // Everything else — 429, 5xx, a timeout, a raw network failure — after the client's own retry
    // has already run its course. Uncounted: the post is fine, the moment was not.
    return { kind: 'uncounted', error: describe(error) };
  }

  const usage = readUsage(message.usage);

  // Guard `stop_reason` before touching `content`: a refusal or a truncation carries no usable
  // summary, and re-sending the identical prompt after a refusal will not change the answer.
  if (message.stop_reason === 'refusal') {
    return { kind: 'refused', ...usageFields(usage) };
  }
  if (message.stop_reason === 'max_tokens') {
    return { kind: 'counted', error: 'max_tokens', ...usageFields(usage) };
  }

  const block = textBlock(message);
  if (block === undefined) {
    return { kind: 'counted', error: 'unparseable', ...usageFields(usage) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(block.text) as unknown;
  } catch {
    return { kind: 'counted', error: 'unparseable', ...usageFields(usage) };
  }

  // A body that parsed but isn't a summary is a structured-output miss, not a transport one: the
  // schema makes every key required, so the shape failing here is about content.
  if (!isReaderSummary(parsed)) {
    return { kind: 'counted', error: 'schema', ...usageFields(usage) };
  }

  return { kind: 'done', summary: normalizeReaderSummary(parsed), ...usageFields(usage) };
}
