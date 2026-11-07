/**
 * One morning digest, start to finish: read the facts, decide the lists, ask for the opener, build
 * the text. The notify tick sends and records it like any other ping.
 *
 * Only the facts read can fail the digest (it throws, and the tick counts an attempt). An
 * unreadable plan and a missing opener are logged and degrade the text, never the send.
 */
import type { PingText } from '../notify/format';
import type { SupabaseEnv } from '../supabase';
import { digestFacts } from './facts';
import { buildDigest, openerInput, prepareDigest } from './format';
import { type OpenerEnv, writeOpener } from './opener';

export interface DigestEnv extends SupabaseEnv, OpenerEnv {}

/** The worst case in subrequests: the facts RPC, then the model call and its one SDK retry. */
export const DIGEST_BUILD_REQUESTS = 3;

/** Build today's digest at `now` in `zone`. Rejects only when the facts can't be read. */
export async function composeDigest(
  env: DigestEnv,
  now: Date,
  zone: string,
  appUrl: string,
): Promise<PingText> {
  const facts = await digestFacts(env, now, zone);
  const { digest, planUnreadable } = prepareDigest(facts, now, zone);
  if (planUnreadable !== undefined) console.warn(`digest: plan unreadable (${planUnreadable})`);

  const outcome = await writeOpener(env, openerInput(digest));
  if ('unavailable' in outcome) {
    console.warn(`digest: opener unavailable — ${outcome.unavailable}`);
    return buildDigest(digest, undefined, appUrl);
  }
  return buildDigest(digest, outcome.opener, appUrl);
}
