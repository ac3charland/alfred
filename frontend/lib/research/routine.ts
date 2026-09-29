import 'server-only';

import type { ResearchConfig } from './config';

/**
 * Starting one research session: a POST to the Routine's API trigger, whose Claude Code session
 * researches the question and PUTs its report back to the delivery route.
 *
 * The request carries three things a caller could get wrong, so each lives here once: the
 * research-preview beta header (the API is experimental and the header may change), the size cap
 * on the question (the trigger takes free text, not a document), and a ten-second timeout (the
 * dispatch route fires up to five posts one after another inside a 60-second budget). Nothing here
 * logs — the token starts the Routine and the brief is the owner's own words — and the error
 * sentences it hands back are fixed text, never anything from the response, because they are
 * stored on the post and read by the owner.
 */

/** The research-preview header the Routines API requires; a change to it is a change here. */
export const ROUTINE_BETA_HEADER = 'experimental-cc-routine-2026-04-01';

/** The Anthropic API version the trigger is called with. */
export const ROUTINE_ANTHROPIC_VERSION = '2023-06-01';

/** How long one fire waits: five sequential fires still fit the dispatch route's 60 seconds. */
export const FIRE_TIMEOUT_MS = 10_000;

/** The longest brief sent whole, in characters. A longer one is cut and says so. */
export const BRIEF_MAX_CHARS = 16_000;

/** What follows a brief that was cut, so the session knows the question was longer. */
export const BRIEF_TRUNCATION_NOTE = '\n[brief truncated]';

/** The post fields a fire reads: which post the report is for, and the question. */
export interface ResearchFireTarget {
  id: string;
  research_brief: string;
}

/**
 * What one fire came to. `error` is the clause the row says after "No report —", so it reads as a
 * sentence fragment and names a cause the owner can act on.
 */
export type ResearchFireOutcome =
  | { ok: true; sessionUrl: string | null }
  | { ok: false; error: string };

/** The brief as the session receives it: whole up to the limit, else cut with a note. */
function briefText(brief: string): string {
  return brief.length > BRIEF_MAX_CHARS
    ? `${brief.slice(0, BRIEF_MAX_CHARS)}${BRIEF_TRUNCATION_NOTE}`
    : brief;
}

/** Why a fire that was answered, but not accepted, failed — in the owner's terms. */
function failureFor(status: number): string {
  if (status === 401 || status === 403) return "the research Routine refused alfred's token";
  if (status === 429) return "the Routine's daily run cap or usage limit was reached";
  return `the research Routine answered HTTP ${String(status)}`;
}

/**
 * The session link out of an accepted fire's body, or null. The link is optional on purpose — it
 * is a preview API — and it lands in an `href`, so anything but an `https` URL is refused here
 * rather than trusted because the answer said so.
 */
async function sessionUrlOf(response: Response): Promise<string | null> {
  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || !('claude_code_session_url' in body)) {
    return null;
  }
  const url = body.claude_code_session_url;
  if (typeof url !== 'string' || !URL.canParse(url)) return null;
  return new URL(url).protocol === 'https:' ? url : null;
}

/**
 * Fire the research Routine for one post. Never throws: a refusal, an outage and a timeout all come
 * back as an outcome, so the route has one thing to switch on and one post to patch.
 */
export async function fireResearchRoutine(
  config: ResearchConfig,
  post: ResearchFireTarget,
): Promise<ResearchFireOutcome> {
  let response: Response;
  try {
    response = await fetch(config.fireUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.fireToken}`,
        'anthropic-beta': ROUTINE_BETA_HEADER,
        'anthropic-version': ROUTINE_ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: `post_id=${post.id}\n---\n${briefText(post.research_brief)}` }),
      signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "the research Routine couldn't be reached" };
  }
  if (!response.ok) return { ok: false, error: failureFor(response.status) };
  return { ok: true, sessionUrl: await sessionUrlOf(response) };
}
