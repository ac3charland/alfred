/**
 * The notify tick's database calls: one RPC that claims everything due to send, and one PATCH
 * per claim that records how its send went. Eligibility, dedupe and abandonment all live in the
 * RPC (`claim_notifications`), so the Worker never decides what is due — it only sends it.
 */
import { type SupabaseEnv, fetchJson, restQueryUrl } from '../supabase';

/**
 * One claim as the RPC returns it — JSON nulls for the other kinds' fields. A `morning_digest`
 * claim carries none: the tick reads the digest's facts separately.
 */
export interface NotificationClaim {
  id: string;
  kind: 'comms_asap' | 'task_due' | 'morning_digest';
  attempts: number;
  /** comms_asap: the roster name, else the sender's name, else their handle. */
  sender: string | null;
  /** comms_asap: the account's label. */
  account: string | null;
  /** comms_asap: the current verdict's one-line ask. */
  ask: string | null;
  /** task_due: the task's title. */
  title: string | null;
  /** task_due: `HH:MM:SS`, as PostgREST spells a `time`. */
  due_time: string | null;
}

/**
 * Claim this tick's pings: the retries first, then whatever just became true, at most `limit`.
 * `zone` is the IANA zone a task's floating due time and the digest time are read in.
 * `digestTime` (`HH:MM`) turns the morning digest on; omitted, the RPC claims no new digest.
 */
export function claimNotifications(
  env: SupabaseEnv,
  now: Date,
  zone: string,
  limit: number,
  digestTime?: string,
): Promise<NotificationClaim[]> {
  return fetchJson<NotificationClaim[]>(
    env,
    restQueryUrl(env, 'rpc/claim_notifications', {}),
    {
      method: 'POST',
      body: JSON.stringify({
        p_now: now.toISOString(),
        p_zone: zone,
        p_limit: limit,
        // Omitted rather than null when off: the parameter defaults to NULL.
        ...(digestTime === undefined ? {} : { p_digest_time: digestTime }),
      }),
    },
    'POST rpc/claim_notifications',
  );
}

/** Record a delivered ping: when, Telegram's id for it, and the text exactly as sent. */
export async function markSent(
  env: SupabaseEnv,
  id: string,
  sent: { at: Date; messageId: number; text: string },
): Promise<void> {
  await fetchJson<unknown[]>(
    env,
    restQueryUrl(env, 'notifications', { id: `eq.${id}` }),
    {
      method: 'PATCH',
      body: JSON.stringify({
        sent_at: sent.at.toISOString(),
        telegram_message_id: sent.messageId,
        text: sent.text,
      }),
    },
    `PATCH notifications (${id})`,
  );
}

/**
 * Count a failed attempt. `attempts` is the count the claim came back with; the RPC stops
 * re-returning a claim once it reaches the ceiling.
 */
export async function recordFailedAttempt(
  env: SupabaseEnv,
  id: string,
  attempts: number,
  error: string,
): Promise<void> {
  await fetchJson<unknown[]>(
    env,
    restQueryUrl(env, 'notifications', { id: `eq.${id}` }),
    {
      method: 'PATCH',
      body: JSON.stringify({ attempts: attempts + 1, last_error: error }),
    },
    `PATCH notifications (${id})`,
  );
}
