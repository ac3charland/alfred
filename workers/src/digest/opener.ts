/**
 * The digest's opener: one or two model-written sentences that frame the day. The only part of
 * the digest the model writes — every count, row and link below it is built in code from the
 * same facts the model is shown, so the lists stay authoritative and the opener is garnish.
 *
 * Nothing here throws, and every failure is the same answer: no opener. A missing key, a typed
 * SDK error, a timeout, a refusal or a reply off-schema all send the digest on time without it
 * (and with today's plan lines listed in its place). Holding a 7 AM message for a garnish would
 * trade the point for the decoration, so no failure is counted or retried.
 *
 * The call shape follows `reader/summarize.ts` by convention, not by import — see that file for
 * why the model calls stay uncoupled.
 */
import Anthropic from '@anthropic-ai/sdk';

import { cap } from '../notify/format';
import type { PlanLine } from './plan';

/** The longest opener the digest carries, ellipsis included. */
export const OPENER_CAP = 600;

/** A few sentences is well under this; a truncation is a failure, not a shorter opener. */
export const OPENER_MAX_TOKENS = 400;

/** Per request, with one retry: the digest waits at most ~20 s for its garnish. Milliseconds. */
export const OPENER_TIMEOUT_MS = 10_000;
export const OPENER_MAX_RETRIES = 1;

/** The facts the opener may draw on — the same values the lists render, after capping. */
export interface OpenerInput {
  /** The headline's date, e.g. `Saturday, Nov 7`. */
  date: string;
  /** Today's plan, or null when no plan covers today (or it couldn't be read). */
  plan: { theme: string | null; lines: PlanLine[] } | null;
  due: { title: string; label: string | null }[];
  /** How many due rows didn't fit in the list. */
  due_overflow: number;
  comms: {
    counts: { asap: number; today: number; whenever: number };
    asks: { tier: string; sender: string; ask: string }[];
  };
  reader_waiting: number;
}

/** What the call came to. */
export type OpenerOutcome = { opener: string } | { unavailable: string };

/** The structured-output schema: one string, nothing else. */
export const OPENER_SCHEMA = {
  type: 'object',
  properties: { opener: { type: 'string' } },
  required: ['opener'],
  additionalProperties: false,
} as const;

export const OPENER_SYSTEM = [
  "You write the opening lines of the owner's 7 AM digest from alfred, their personal task system.",
  'The input is JSON: the date, today’s weekly-plan lines and the week’s theme (or null), the tasks',
  'due or late, the people waiting on a reply, and how many articles are in the reading list.',
  'Below your lines the digest lists all of it, so your job is orientation, not inventory.',
  '',
  'Write 1–3 sentences, at most 450 characters, that orient the owner to the shape of the day,',
  'using only the facts given. When something is late or someone is waiting, lead with that; draw',
  'on today’s plan lines and the theme for the why. Do not restate counts or repeat the lists, and',
  'never name a task, person or article that is not in the input. Plain text, no markup, second',
  'person, no greeting (the headline is the greeting). With nothing due and no plan, say so',
  'plainly and briefly.',
].join('\n');

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The env the call reads. Both optional: either missing is "no opener", not a crash. */
export interface OpenerEnv {
  ANTHROPIC_API_KEY?: string;
  DIGEST_MODEL?: string;
}

/** Ask for the opener. Resolves to the text, or to why there is none; never rejects. */
export async function writeOpener(env: OpenerEnv, input: OpenerInput): Promise<OpenerOutcome> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? '';
  if (apiKey === '') return { unavailable: 'ANTHROPIC_API_KEY is not set' };
  const model = env.DIGEST_MODEL?.trim() ?? '';
  if (model === '') return { unavailable: 'DIGEST_MODEL is not set' };

  // Built per call: an isolate is reused across invocations, and a singleton keeps a stale key.
  const client = new Anthropic({
    apiKey,
    timeout: OPENER_TIMEOUT_MS,
    maxRetries: OPENER_MAX_RETRIES,
  });

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: OPENER_MAX_TOKENS,
      // Omitted, Sonnet 5 thinks adaptively — billed as output and counted against max_tokens.
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OPENER_SCHEMA } },
      system: OPENER_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    });
  } catch (error) {
    return { unavailable: describe(error) };
  }

  if (message.stop_reason === 'refusal') return { unavailable: 'refusal' };
  if (message.stop_reason === 'max_tokens') return { unavailable: 'max_tokens' };

  const block = message.content.find((part): part is Anthropic.TextBlock => part.type === 'text');
  if (block === undefined) return { unavailable: 'no text' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(block.text) as unknown;
  } catch {
    return { unavailable: 'unparseable' };
  }
  const opener =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)['opener']
      : undefined;
  if (typeof opener !== 'string') return { unavailable: 'schema' };

  const text = cap(opener.trim(), OPENER_CAP);
  return text === '' ? { unavailable: 'empty' } : { opener: text };
}
