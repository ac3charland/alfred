/**
 * What the model is asked for, and the pure steps between its answer and a legal database write.
 *
 * Three layers, as in the Inbox classifier. The output schema closes the value space at
 * generation time — an invented tier is not something the model can emit. This module is the
 * second: a shape check that treats a body which slipped the schema as no answer at all, plus the
 * two rules the schema cannot express, both of which move a tier the model chose:
 *
 *   - the FLOOR — an obligation is never invisible, so an owed reply cannot sit on the shelf;
 *   - the BACKLOG CAP — nothing old enough to be a backlog gets the tier that claims "now".
 *
 * The database is the third layer and has the last word (a tier and how it was reached must
 * arrive together; the tier is an enum there too).
 *
 * `undefined`, never `null`, is how absence is spelled: the package bans the `null` literal, and
 * `JSON.stringify` drops undefined keys, so a verdict doubles as a PATCH body.
 */
import type { CommTier } from './types';

/**
 * One judgment of one message. Every field is required — unlike the Inbox's verdict, where
 * abstention is a first-class answer. There is no useful "no opinion" here: a message either
 * asks something of the owner or it doesn't, and a blank tier would leave the row exactly where
 * an unjudged row already sits.
 */
export interface CommVerdict {
  tier: CommTier;
  /** Whether the owner owes a reply. An input to the tier, and the floor rule's trigger. */
  owes_reply: boolean;
  /** What the message wants from the owner, and by when. Never what it is about. */
  ask: string;
  /** Why this tier — the line that makes the rubric auditable rather than merely present. */
  reason: string;
}

/** The four tiers, in the order the schema offers them and the UI shows them. */
export const COMM_TIERS = ['asap', 'today', 'whenever', 'fyi'] as const;

/**
 * The JSON Schema sent as `output_config.format.schema`. Fixed rather than assembled per sweep —
 * the tiers are the same four forever, so unlike the Inbox's live folder ids there is nothing
 * here to rebuild. Every key is required and the object is closed, which structured outputs
 * demand: a field the model may omit is a field the caller has to invent a default for.
 */
export const COMM_VERDICT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['tier', 'owes_reply', 'ask', 'reason'],
  properties: {
    tier: { enum: [...COMM_TIERS] },
    owes_reply: { type: 'boolean' },
    ask: { type: 'string' },
    reason: { type: 'string' },
  },
};

/** How urgent each tier claims to be, so the two rules below can compare two of them. */
const RANK: Record<CommTier, number> = { asap: 3, today: 2, whenever: 1, fyi: 0 };

/** Whether a value is one of the four tiers — the check the enum already made, made again. */
function isTier(value: unknown): value is CommTier {
  return typeof value === 'string' && value in RANK;
}

/**
 * Shape-check a parsed model response, or reject it whole.
 *
 * Stricter than the Inbox's parser, which drops a bad field and keeps the rest. Nothing here can
 * be partially useful: a verdict without a tier says nothing, and a tier outside the enum means
 * the structured output failed — repairing that by guessing would be alfred inventing a judgment
 * and stamping the model's name on it. A rejected body takes the content-shaped failure path,
 * which counts an attempt and moves on.
 */
export function parseCommVerdict(raw: unknown): CommVerdict | undefined {
  // Loose `== undefined` on purpose: it is the only way to catch a JSON `null` body without
  // writing the `null` literal this package bans, and `typeof null === 'object'` would otherwise
  // let a bare `null` response through to a property read that throws.
  if (raw == undefined || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const body = raw as Record<string, unknown>;

  const { tier, owes_reply: owesReply, ask, reason } = body;
  if (!isTier(tier)) return undefined;
  if (typeof owesReply !== 'boolean') return undefined;
  if (typeof ask !== 'string' || typeof reason !== 'string') return undefined;

  // Rebuilt field by field rather than spread, so nothing the model volunteered rides along into
  // the verdict row.
  return { tier, owes_reply: owesReply, ask, reason };
}

/**
 * The floor rule: an obligation never falls below `whenever`.
 *
 * One blended number is what the owner asked for, but a pure urgency sort buries the
 * non-urgent-but-owed message at the bottom — which is the avoidance failure this module exists
 * to fix, reintroduced by the sort itself. Lifting it onto the lowest COUNTED tier keeps the
 * single number while making that class of message structurally un-buriable.
 */
export function applyFloor(verdict: CommVerdict): CommVerdict {
  if (!verdict.owes_reply || verdict.tier !== 'fyi') return verdict;
  return { ...verdict, tier: 'whenever' };
}

/** How old a message may be and still be judged worth interrupting for. */
export const BACKLOG_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Cap a tier for a message old enough to be backlog: nothing that has already waited gets the
 * one tier that claims "break focus for this".
 *
 * Keyed on the message's AGE rather than on a "backfilled" flag, because a flag would only cover
 * the first sweep after a source is enabled — while any lag between arriving and being judged (a
 * classifier outage, a re-authorised account catching up on a week) produces exactly the same
 * backlog, and would sail past a flag-shaped check. Only ASAP is capped: the other three make no
 * claim about right now, so a stale one costs nothing.
 */
export function capForBacklog(
  tier: CommTier,
  window: { receivedAt: Date; now: Date; maxAgeMs?: number },
): CommTier {
  if (tier !== 'asap') return tier;
  const age = window.now.getTime() - window.receivedAt.getTime();
  // An unreadable timestamp is capped rather than trusted: an age nobody can compute has not
  // earned the tier that interrupts. NaN fails every comparison, so it is checked by name.
  if (Number.isNaN(age)) return 'today';
  return age >= (window.maxAgeMs ?? BACKLOG_MAX_AGE_MS) ? 'today' : 'asap';
}

/**
 * Where a message alfred could not judge lands, and what it says. Both are unjudged rather than
 * shelved: what could not be judged is unknown, and unknown is not nothing — but a tier alfred
 * didn't choose does not get the one that claims "now", so both sit on Today, marked.
 */
export const UNJUDGED_TIER: CommTier = 'today';
export const UNJUDGED_CEILING_ASK =
  'Not judged — five attempts, none of them usable. Treated as owed until it can be read.';
export const UNJUDGED_DECODE_ASK =
  'Not judged — the message body could not be read. Treated as owed until it can be read.';

/**
 * Where a refusal lands. Terminal and its own state: re-sending an identical prompt cannot change
 * a refusal, so this is not the can't-judge path and does not enter the queue — it is filed on the
 * shelf with a visible flag, exactly as header-filtered mail is.
 */
export const REFUSAL_TIER: CommTier = 'fyi';
export const REFUSAL_ASK = 'The model declined to judge this message.';
