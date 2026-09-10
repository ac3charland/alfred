/**
 * The deterministic newsletter filter — the one thing that shelves a message without a model call.
 *
 * Bulk mail is always non-urgent and never an obligation, so paying a model to decide that is pure
 * waste; the headers answer it for free, and keeping the whale out of the prompt keeps both the
 * counts and the bill honest. What lands here is filed straight to the unbadged shelf with a flag
 * saying the FILTER, not the model, put it there — a shelved message with no verdict has to be
 * distinguishable from one the model actually judged.
 *
 * The three conditions below are the whole rule, and each exists because these headers are
 * conventions rather than guarantees, so the filter leaks both ways — unequally. A newsletter that
 * slips through costs one cheap model call and lands on the shelf with a verdict, self-correcting
 * as the example set learns the shape. A real message wrongly filtered is the expensive miss: it
 * never reaches the classifier at all, so no amount of tuning the rubric can reach it. Every
 * condition here is therefore biased toward letting mail through.
 */
import { headerValue } from './email-text';
import type { GmailHeader } from './gmail-api';

/** Who sent it, and who the owner has said matters. */
export interface NewsletterContext {
  /** The sender's address, as parsed from `From`. Compared lower-cased. */
  senderHandle: string;
  /** Every email handle on the roster, lower-cased. */
  rosterHandles: Set<string>;
}

/**
 * Whether this message is bulk mail the classifier should never see.
 *
 * Strong signals only: a genuine list header. `Precedence: bulk` is deliberately NOT one — plenty
 * of ordinary automated mail sets it, including the receipts and alerts that are exactly the
 * transactional mail worth reading.
 *
 * And a sender on the roster is never filtered, whatever the headers say. A priority person on a
 * mailing list is still a priority person, and the roster is the one input the owner stated
 * outright rather than inferred.
 */
export function isNewsletter(
  headers: GmailHeader[] | undefined,
  context: NewsletterContext,
): boolean {
  if (context.rosterHandles.has(context.senderHandle.toLowerCase())) return false;

  return (
    headerValue(headers, 'List-Unsubscribe') !== undefined ||
    headerValue(headers, 'List-ID') !== undefined
  );
}
