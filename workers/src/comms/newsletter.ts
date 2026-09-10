/**
 * The deterministic newsletter filter — the one thing that shelves a message without a model call.
 *
 * Bulk mail is always non-urgent and never an obligation, so paying a model to decide that is pure
 * waste; the headers answer it for free, and keeping the whale out of the prompt keeps both the
 * counts and the bill honest. What lands here is filed straight to the unbadged shelf with a flag
 * saying the FILTER, not the model, put it there — a shelved message with no verdict has to be
 * distinguishable from one the model actually judged.
 *
 * `List-Unsubscribe` and `List-ID` are RFC 2369/2919 conventions, not authentication: any sender
 * sets them on their own outgoing mail, including automated systems that are exactly the source of
 * real obligations — a password-reset notice, a failed payment, a security alert. So the header
 * alone is never sufficient to concede the shelf. It clears two gates, both biased toward letting
 * mail through to the classifier rather than past it:
 *
 *   1. the roster — a sender the owner has named is never filtered, whatever the headers say;
 *   2. the subject line — read for language that means the message wants something ("action
 *      required", "verify your", "payment failed", …). A subject that reads that way sends the
 *      message to the classifier instead of the shelf, and so does a subject this filter cannot
 *      see at all: absence of a checkable subject is never read as evidence the message is safe to
 *      shelve.
 *
 * A newsletter that slips through costs one cheap model call and lands on the shelf with a
 * verdict, self-correcting as the example set learns the shape. A real message wrongly filtered is
 * the expensive miss: it never reaches the classifier at all, so no amount of tuning the rubric can
 * reach it. Every condition here is therefore biased toward letting mail through.
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
 * A deliberately generous set of subject-line cues that a message wants something from the owner:
 * verification prompts, security alerts, billing failures, deadlines. Genuine list software
 * (newsletters, digests, marketing sends) essentially never produces subjects like these; the
 * automated alerts and transactional mail that also happen to set `List-Unsubscribe`/`List-ID`
 * overwhelmingly do. A false positive here costs one classifier call; a false negative hides a real
 * obligation — so, like the header rule above it, this list is biased hard toward matching.
 *
 * This is a heuristic, not proof: a message engineered to avoid every cue below while still
 * carrying a list header would still be filtered. See newsletter.test.ts and the module docstring
 * for what that residual risk means in practice.
 */
const ASK_CUES: readonly string[] = [
  'action required',
  'action needed',
  'response required',
  'response needed',
  'please confirm',
  'please verify',
  'please respond',
  'please reply',
  'please review',
  'please approve',
  'verify your',
  'confirm your',
  'approval required',
  'review requested',
  'requires your attention',
  'needs your attention',
  'sign-in',
  'sign in attempt',
  'log in attempt',
  'login attempt',
  'new device',
  'security alert',
  'security code',
  'verification code',
  'one-time code',
  'one-time passcode',
  '2fa',
  'two-factor',
  'unusual activity',
  'unrecognized',
  'suspicious activity',
  'password reset',
  'reset your password',
  'reset password',
  'account locked',
  'account suspended',
  'account on hold',
  'update your payment',
  'payment failed',
  'payment declined',
  'past due',
  'overdue',
  'invoice',
  'unpaid',
  'balance due',
  'urgent',
  'immediately',
  'deadline',
  'expires',
  'expiring',
  'final notice',
];

/**
 * Whether a subject reads like it wants something from the owner.
 *
 * `undefined` — no subject reached this check at all — counts as YES. A filter deciding "safe to
 * shelve" needs evidence the message is safe; a subject it never saw is not that evidence, so the
 * fail-safe direction is to treat it exactly like a subject that failed the check.
 */
function looksLikeAnAsk(subject: string | undefined): boolean {
  if (subject === undefined) return true;
  const lowered = subject.toLowerCase();
  return ASK_CUES.some((cue) => lowered.includes(cue));
}

/**
 * Whether this message is bulk mail the classifier should never see.
 *
 * Strong header signals only: a genuine list header. `Precedence: bulk` is deliberately NOT one —
 * plenty of ordinary automated mail sets it, including the receipts and alerts that are exactly the
 * transactional mail worth reading. A sender on the roster is never filtered, whatever the headers
 * say: a priority person on a mailing list is still a priority person, and the roster is the one
 * input the owner stated outright rather than inferred.
 *
 * Clearing the header gate is necessary but not sufficient: the subject must also fail to read like
 * an ask (`looksLikeAnAsk`), which is what keeps a real obligation from vanishing onto the shelf
 * merely because its sender's mail system also sets an unsubscribe header.
 */
export function isNewsletter(
  headers: GmailHeader[] | undefined,
  context: NewsletterContext,
): boolean {
  if (context.rosterHandles.has(context.senderHandle.toLowerCase())) return false;

  const hasListHeader =
    headerValue(headers, 'List-Unsubscribe') !== undefined ||
    headerValue(headers, 'List-ID') !== undefined;
  if (!hasListHeader) return false;

  return !looksLikeAnAsk(headerValue(headers, 'Subject'));
}

/**
 * The raw header signal alone, with no roster check and no ask-language override: whether this
 * message carries an RFC 2369/2919 list header at all.
 *
 * For handing to the classifier as EVIDENCE rather than as a verdict — see the "carries a list
 * header" note `prompt.ts` renders when a caller supplies this. Unauthenticated exactly like
 * `isNewsletter`'s header check, so a caller wiring this in must treat it the same way the model is
 * told to: one weak, forgeable signal among many, never a bypass.
 */
export function hasListHeaderSignal(headers: GmailHeader[] | undefined): boolean {
  return (
    headerValue(headers, 'List-Unsubscribe') !== undefined ||
    headerValue(headers, 'List-ID') !== undefined
  );
}
