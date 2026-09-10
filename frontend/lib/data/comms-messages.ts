import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import type { CommMessagesQuery } from '@/lib/api/schemas';
import { QUEUED_TIERS } from '@/lib/comms/queue';
import type { Database } from '@/lib/database.types';
import type { CommAccount, CommCorrection, CommMessage, CommTier } from '@/lib/types';

/**
 * The single-row server layer behind the Comms row verbs — the reads a verb does before it
 * writes, and the one write two of them share.
 *
 * Separate from `lib/data/comms.ts`, which seeds the whole module at the shell: these are
 * per-request lookups keyed on a message the owner just acted on, and they hand back the raw
 * `{ data, error }` so the route decides the status code (a read layer reports; it doesn't
 * choose HTTP).
 */

/**
 * How much of a body a correction carries into the example set. An email body is not a
 * one-line capture, and an uncapped excerpt makes the classifier's bill grow with every
 * correction the owner records — the prompt has to stop growing for the cost table to mean
 * anything.
 */
export const CORRECTION_EXCERPT_LENGTH = 600;

/** One message by id, or `null` when there is no such row. */
export async function readCommMessage(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ data: CommMessage | null; error: PostgrestError | null }> {
  // `.maybeSingle()`, not `.single()`: the shared error mapper has no PGRST116 case, so a
  // missing row would surface as a 500 rather than the 404 it is.
  return supabase.from('comm_messages').select('*').eq('id', id).maybeSingle();
}

/** The account a message arrived on — its label is denormalised onto every correction. */
export async function readCommAccount(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ data: CommAccount | null; error: PostgrestError | null }> {
  return supabase.from('comm_accounts').select('*').eq('id', id).maybeSingle();
}

/**
 * One side of the module: the response queue, or the FYI shelf.
 *
 * The two are asked for by name rather than filtered by the caller because they are wildly
 * different reads — the queue is meant to be a handful of rows and the shelf is thousands, so
 * an endpoint that answered both without saying which would make the expensive one the default.
 * The predicates mirror `isQueued` / `isShelved` exactly, so the server and the client agree on
 * which side a row is on.
 */
export async function getCommMessagesByScope(
  supabase: SupabaseClient<Database>,
  query: CommMessagesQuery,
): Promise<{ data: CommMessage[] | null; error: PostgrestError | null }> {
  const base = supabase
    .from('comm_messages')
    .select('*')
    // Outbound rows are mirrored only as the reply-detection signal; they are never rendered.
    .eq('direction', 'inbound');

  const scoped =
    query.scope === 'queue'
      ? base.is('cleared_at', null).in('tier', [...QUEUED_TIERS])
      : // Shelved is "judged, and not in the queue": the `fyi` tier itself, plus every row that
        // left the queue by one of its exits.
        base.or('tier.eq.fyi,cleared_at.not.is.null');

  const ordered = scoped.order('received_at', { ascending: false });
  return query.limit === undefined ? await ordered : await ordered.limit(query.limit);
}

/** What a correction records, beyond what the message itself already says. */
export interface CorrectionInput {
  message: CommMessage;
  /** The account's display label, denormalised so the example outlives the message. */
  accountLabel: string;
  /** The tier the OWNER chose. */
  chosenTier: CommTier;
  kind: CommCorrection['kind'];
}

/**
 * Record one correction — the row that doubles as a few-shot example.
 *
 * Written by both clearing-as-nothing-to-answer (a demotion to FYI) and the tier
 * dropdown, because both say the same thing: the model put this row somewhere the owner
 * disagrees with. `not_replying` writes nothing at all — the verdict was right and the owner is
 * declining — which is the whole reason the clearing verb is two verbs.
 *
 * `created_version` is sent as a placeholder the database immediately overwrites: a trigger
 * numbers the example set, so no writer can forget to bump it and no two writers can disagree
 * about the count.
 */
export async function recordCommCorrection(
  supabase: SupabaseClient<Database>,
  { message, accountLabel, chosenTier, kind }: CorrectionInput,
): Promise<{ data: CommCorrection | null; error: PostgrestError | null }> {
  const excerpt = message.body.trim().slice(0, CORRECTION_EXCERPT_LENGTH);
  return supabase
    .from('comm_corrections')
    .insert({
      message_id: message.id,
      account_label: accountLabel,
      sender_handle: message.sender_handle,
      sender_name: message.sender_name,
      subject: message.subject,
      body_excerpt: excerpt === '' ? null : excerpt,
      // The model's own guess, and `null` for a row it never judged — a correction of an
      // unjudged row still teaches, but has no guess to contrast.
      model_tier: message.tier,
      chosen_tier: chosenTier,
      kind,
      created_version: 0,
    })
    .select()
    .single();
}
