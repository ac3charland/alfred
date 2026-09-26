/**
 * One fresh newsletter, from the mailbox to a stored post — the part of the tick that runs before
 * any model call, and the only part that talks to Gmail.
 *
 * The ORDER here is the design, not an implementation detail:
 *
 *   read the message → extract → INSERT the post → STAMP the comms row → only then summarise.
 *
 * The insert comes first because title and link are the floor: a tick that dies leaves a pending
 * row the next tick picks up, never a half-written summary and never a message that quietly went
 * nowhere. The comms stamp comes next because it is what takes the newsletter off the Comms FYI
 * shelf and out of the worklist view — and because the anti-join would otherwise hand this same
 * message back every tick forever, burning a Gmail read each time.
 *
 * Two mailbox states are NOT failures and are the reason this file has its own result type.
 * A 404 means the owner hard-deleted the message between the comms poll and now; a 200 carrying
 * `TRASH` or `SPAM` means they binned it and Gmail is still serving it. Both claim the comms row
 * and insert NOTHING — putting mail the owner deleted on purpose into their reading list is the
 * one outcome the module must never produce. The 404 is tested on `status` BEFORE the
 * `rejected`/`transport` split, because `gmail-api.ts` files every non-auth status under
 * `transport` and a transport failure ends the whole tick.
 */
import type { GmailClient, GmailMessage } from '../comms/gmail-api';
import type { SupabaseEnv } from '../supabase';
import { type ExtractedPost, extractPost } from './extract';
import { JSON_NULL, claimCommMessage, insertPost, patchPost } from './store';
import type { WorklistRow } from './types';

/** What a post with no readable body is filed as, with no model call behind it. */
export const NO_READABLE_BODY = 'no readable body';

/** Why a message was claimed without a post being written. Logged by the entrypoint, not here. */
export type SkipReason = 'deleted' | 'binned';

/** What one fresh item did. The tick's loop switches on `kind` and nothing else. */
export type IntakeResult =
  /** Stored, claimed, and ready for the model (or for the cap to defer it). */
  | { kind: 'ready'; id: string; post: ExtractedPost }
  /** Stored and claimed, but there was no text to summarise — already filed as `failed`. */
  | { kind: 'failed'; id: string }
  /** The message is gone or binned: the comms row is claimed and no post exists. */
  | { kind: 'claimed'; reason: SkipReason }
  /** A post already existed. The comms row is claimed anyway, and this tick moves on. */
  | { kind: 'conflict' }
  /** The credential will not work again without a human. The tick stops and stamps health. */
  | { kind: 'systemic'; error: string }
  /** Gmail had a bad minute. The tick stops with nothing advanced and retries next time. */
  | { kind: 'transport'; error: string };

/** Labels that mean the owner has thrown the message away since the comms poll mirrored it. */
const BINNED_LABELS = new Set(['TRASH', 'SPAM']);

/** Everything the intake needs that is not the row itself. */
export interface IntakeOptions {
  /** The roster's name for the sending publication — the author's fallback and the prompt's header. */
  publicationName: string;
  /** The tick's instant. Every timestamp written for this item is this one. */
  now: Date;
  /**
   * Whether the daily ceiling is already spent. It decides the INSERT's lease and nothing else:
   * on a capped day the row is stored unleased so tomorrow's tick can take it, because the insert
   * is the claim and claiming a row this tick will not summarise would strand it.
   */
  capped: boolean;
}

/** Whether Gmail is still serving a message the owner has binned. */
function isBinned(message: GmailMessage): boolean {
  return (message.labelIds ?? []).some((label) => BINNED_LABELS.has(label));
}

/**
 * Read, extract, insert, claim. Returns what the loop should do next; throws only when the
 * database does, which is the one failure the tick has no answer for.
 */
export async function intakePost(
  env: SupabaseEnv,
  client: GmailClient,
  row: WorklistRow,
  options: IntakeOptions,
): Promise<IntakeResult> {
  const fetched = await client.getMessage(row.gmail_message_id);

  if (!fetched.ok) {
    // Status first: a hard-deleted message is a 404, which `gmail-api.ts` reports as `transport`
    // with the status riding along — and transport ends the tick, which is exactly wrong for a
    // message that is never coming back.
    if (fetched.status === 404) {
      await claimCommMessage(env, row.comm_message_id, options.now);
      return { kind: 'claimed', reason: 'deleted' };
    }
    if (fetched.reason === 'rejected') return { kind: 'systemic', error: fetched.detail };
    return { kind: 'transport', error: fetched.detail };
  }

  if (isBinned(fetched.value)) {
    await claimCommMessage(env, row.comm_message_id, options.now);
    return { kind: 'claimed', reason: 'binned' };
  }

  const post = extractPost(
    fetched.value,
    { name: options.publicationName },
    {
      receivedAt: row.received_at,
    },
  );

  const inserted = await insertPost(env, {
    publication_id: row.publication_id,
    comm_message_id: row.comm_message_id,
    account_key: row.account_key,
    gmail_message_id: row.gmail_message_id,
    rfc822_message_id: post.rfc822_message_id ?? row.rfc822_message_id,
    title: post.title,
    author: post.author,
    canonical_url: post.canonical_url,
    received_at: post.received_at,
    text: post.text,
    word_count: post.word_count,
    html_extracted: post.html_extracted,
    html: post.html,
    summary_state: 'pending',
    // The insert IS the lease. On a capped day it is deliberately left free.
    summarizing_since: options.capped ? JSON_NULL : options.now.toISOString(),
  });

  // The claim happens on BOTH branches, conflict included: whoever wrote the post, this message
  // has been dealt with, and leaving it unclaimed means another Gmail read every five minutes.
  await claimCommMessage(env, row.comm_message_id, options.now);
  if (!inserted.inserted) return { kind: 'conflict' };

  if (post.text === '') {
    // Filed immediately rather than left pending: there is nothing for the model to read, so a
    // retry would cost a call and reach the same answer. The lease is released in the same patch.
    await patchPost(env, inserted.id, {
      summary_state: 'failed',
      last_error: NO_READABLE_BODY,
      summarizing_since: JSON_NULL,
    });
    return { kind: 'failed', id: inserted.id };
  }

  return { kind: 'ready', id: inserted.id, post };
}
