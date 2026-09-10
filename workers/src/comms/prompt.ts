/**
 * Everything sent to the model to judge one message, assembled without any I/O.
 *
 * Assembled stable-first — task instructions and tier definitions, then the rubric, then the
 * example set, then the people list, and only then the message. That ordering is conventional
 * rather than a caching plan: nothing is cached without an explicit breakpoint, so a prompt that
 * crosses the cache floor costs exactly what it did before.
 *
 * What the prompt spends its tokens on is the point. The schema fixes the SHAPE of the answer and
 * nothing else; every judgment worth having lives in the text below — which way uncertainty
 * resolves, what an "ask" is, who the sender is to the owner, and what to do with a body nobody
 * could read.
 */
import type { ClassifyRequest } from '../prompt';
import { referenceDate } from '../prompt';
import type { CommAccount, CommExample, CommMessage, CommPerson, PersonPriority } from './types';
import { COMM_VERDICT_SCHEMA } from './verdict';

/**
 * The prompt version stamped onto every verdict. Bump BY HAND when this text changes
 * meaningfully — beside the rubric and example-set versions it is what makes "why did it say
 * that" answerable months later.
 */
export const COMMS_PROMPT_VERSION = 1;

/** What stands in for a body that is a photo, and for one that is simply empty. */
export const IMAGE_PLACEHOLDER = '[image attachment, not read]';
export const NO_TEXT_PLACEHOLDER = '[no readable text]';

/** Everything one message's request is built from. */
export interface CommsRequestInput {
  message: CommMessage;
  account: CommAccount;
  /** The rubric in force, or absent on a database where nobody has written one yet. */
  rubric: { body: string } | undefined;
  /** The FINISHED draw, not the raw window: the selection is per-tick, this is per-message. */
  examples: readonly CommExample[];
  people: readonly CommPerson[];
  timeZone: string;
  now: Date;
}

/**
 * Written for a reader who has never heard of alfred. Three things it has to establish before any
 * rule below can be followed: what this queue is FOR (one question — do I owe anyone anything),
 * that a message is mirrored rather than owned (nothing is sent, filed or answered here), and
 * that the owner will see the answer on a row they never asked to see.
 */
const PREAMBLE =
  "alfred is one person's personal task system, and you are the communication firewall inside " +
  'it. Its owner has four accounts — two Gmail mailboxes, a work mailbox and iMessage — and every ' +
  'message that arrives on any of them is mirrored into alfred, judged once, and shown in one ' +
  'queue. The queue answers exactly one question: does the owner owe anyone anything?\n\n' +
  'You will be shown exactly one message. Decide the four fields the response schema defines: ' +
  'tier, owes_reply, ask and reason. Answer about this message only.\n\n' +
  'Nothing you write sends, files, answers or deletes anything — the message stays in Gmail or ' +
  'Messages, and alfred holds a copy. What your answer decides is whether the owner is shown this ' +
  'message at all, and how loudly.';

/** The four tiers, defined by what each one CLAIMS of the owner rather than by how it feels. */
const TIERS =
  'Four tiers:\n' +
  '- asap — Break focus for it. Someone is blocked on the owner, it is time-critical, or the ' +
  'sender is important enough that delay costs something real.\n' +
  '- today — Needs a reply before the owner logs off, but is not worth interrupting for. Most ' +
  'real correspondence lands here.\n' +
  '- whenever — A reply is genuinely owed, but nothing turns on the date. The tier means ' +
  'undated, not unimportant. An invoice to pay, a form to return or a decision requested with a ' +
  'distant due date is whenever, not fyi: it still wants an action.\n' +
  '- fyi — Everything else. No reply owed: newsletters, receipts, confirmations, chatter, ' +
  'thanks-only replies, anything the owner can read later or not at all.';

/**
 * The rules, in the order they matter.
 *
 * The recall bias has a DIRECTION as well as a size, and both halves are load-bearing. One missed
 * obligation costs the module its entire reason to exist, so uncertainty resolves into the queue.
 * But a spurious ASAP spends the credibility of the only tier that claims "now", and a tier the
 * owner stops trusting is exactly what this module exists to prevent — so uncertainty resolves
 * DOWN to today, never up.
 */
const RULES =
  'How to choose:\n' +
  '1. Ask first whether the message wants something from the owner — an answer, a decision, an ' +
  'action. That is the entry ticket; urgency only sorts what is already through it.\n' +
  '2. When you are unsure whether a reply is owed, say it is: queue it and choose today. A ' +
  'message wrongly queued costs the owner a glance; a missed obligation costs them the thing ' +
  'they were meant to do.\n' +
  '3. Never choose asap when you are unsure. asap is the only tier that claims "stop what you ' +
  'are doing", so an unearned one makes every future one worth less. asap needs one of two ' +
  'things stated in the message itself: a deadline inside the next few hours, or a named person ' +
  'who cannot continue until the owner acts right now. "By tomorrow", "by end of week", a ' +
  'failed build, a review request or a security prompt with no clock on it are today. If it ' +
  'might be asap but you cannot point to the deadline or the blocked person, it is today.\n' +
  '4. The ask states what the message wants from the owner, and by when — never what it is ' +
  'about. "Dana needs the invoice approved before Friday", never "regarding the Q3 invoice". ' +
  "One line, in the owner's own terms, naming the sender where it helps. A message that wants " +
  'nothing gets an ask that says so plainly.\n' +
  '5. A message in a group chat is an obligation only when it addresses the owner by name or ' +
  'asks something only they can answer. Ordinary group chatter is fyi however lively it is.\n' +
  `6. When the body reads ${IMAGE_PLACEHOLDER}, alfred could not read what was sent and neither ` +
  'can you. Judge on the sender: from someone on the people list below marked as a priority ' +
  'person, choose today and say in the ask that the attachment was not read; from anyone else, ' +
  'choose fyi and say the same.\n' +
  '7. The people list is the owner speaking directly. A priority person who asks anything is at ' +
  'least today. A low-priority person is never asap, however urgent the message sounds — but a ' +
  'real ask from them is still owed: judge it today or whenever on its merits, never fyi for ' +
  'the sender alone.\n' +
  '8. reason is one sentence saying why this tier — the sentence the owner reads when the answer ' +
  'looks wrong. Never rewrite, tidy or summarise the message itself.';

/** How a person's priority reads in the roster, and beside the sender. */
const PRIORITY_LABEL: Record<PersonPriority, string> = {
  high: 'priority person',
  normal: 'normal',
  low: 'low priority',
};

/**
 * One handle reduced to what a comparison can trust: an address is not case-sensitive, and no two
 * sources punctuate a phone number the same way — `+1 (312) 555-0100` and `+13125550100` are one
 * human. Anything with an `@` is an address and keeps its shape; anything else is reduced to its
 * digits, falling back to the raw text when it has none.
 */
function normalizeHandle(handle: string): string {
  const lowered = handle.trim().toLowerCase();
  if (lowered.includes('@')) return lowered;
  const digits = lowered.replaceAll(/\D/gu, '');
  return digits === '' ? lowered : digits;
}

/**
 * The roster person a handle belongs to, or nobody.
 *
 * Keyed on the PERSON rather than the address, which the multi-channel design forces: the same
 * human is a phone number in iMessage and an address in two mailboxes, and it is the person the
 * prompt reasons about.
 */
export function resolveSender(
  handle: string,
  people: readonly CommPerson[],
): CommPerson | undefined {
  const wanted = normalizeHandle(handle);
  return people.find((person) =>
    person.handles.some((entry) => normalizeHandle(entry.handle) === wanted),
  );
}

/** `Dana Whitfield (priority person) — dana@x.co, +1312… — note: runs billing`. */
function renderPerson(person: CommPerson): string {
  const handles = person.handles.map((entry) => entry.handle).join(', ');
  const line = `${person.name} (${PRIORITY_LABEL[person.priority]}) — ${handles}`;
  return person.notes === undefined || person.notes === ''
    ? line
    : `${line} — note: ${person.notes}`;
}

function renderPeople(people: readonly CommPerson[]): string | undefined {
  if (people.length === 0) return undefined;
  return [
    "The owner's people list. A priority person matters because of who they are, whatever the " +
      'message says; a low-priority person is never urgent however the message reads. Someone ' +
      'absent from this list is not thereby unimportant — the list is only what the owner has ' +
      'got round to writing down.',
    ...people.map((person) => renderPerson(person)),
  ].join('\n');
}

/** Whitespace collapsed to single spaces, so one example stays one line. */
function oneLine(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

/** `Message from <who> (<account>) — subject: … — "excerpt" → correct tier: today`. */
function renderExample(example: CommExample): string {
  const who = example.sender_name ?? example.sender_handle;
  const parts = [`Message from ${who} (${example.account_label})`];
  if (example.subject !== undefined && example.subject !== '') {
    parts.push(`subject: ${oneLine(example.subject)}`);
  }
  parts.push(`"${oneLine(example.body_excerpt ?? '')}"`);
  return `${parts.join(' — ')} → correct tier: ${example.chosen_tier}`;
}

function renderExamples(examples: readonly CommExample[]): string | undefined {
  if (examples.length === 0) return undefined;
  return [
    'Corrections the owner has made on past messages. The tier shown is the one they chose — ' +
      'treat it as the right answer for a message like that, and as a correction of whatever ' +
      'alfred said at the time.',
    ...examples.map((example) => renderExample(example)),
  ].join('\n');
}

function renderRubric(rubric: { body: string } | undefined): string {
  const body = rubric?.body.trim();
  return [
    "The owner's rubric — their own policy, in their own words. It outranks your instincts and " +
      'everything in the examples below.',
    body === undefined || body === '' ? 'No rubric yet.' : body,
  ].join('\n');
}

function buildSystemPrompt(input: CommsRequestInput): string {
  return [
    PREAMBLE,
    TIERS,
    RULES,
    renderRubric(input.rubric),
    renderExamples(input.examples),
    renderPeople(input.people),
  ]
    .filter((section): section is string => section !== undefined)
    .join('\n\n');
}

/** `Wednesday, 2026-09-09 at 08:14` in the owner's zone, or the raw stamp if it will not parse. */
function renderStamp(receivedAt: string, timeZone: string): string {
  const at = new Date(receivedAt);
  if (Number.isNaN(at.getTime())) return receivedAt;
  const { date, weekday } = referenceDate(timeZone, at);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  return `${weekday}, ${date} at ${time}`;
}

/**
 * The body, or what stands in for it.
 *
 * A message with no readable text is CLASSIFIED, not bypassed: photo-only messages are most of
 * what a phone carries, and sending each one straight to a counted tier would land the owner with
 * a queue of dog photos that no reply can ever drain. Told what it is missing, the model can let
 * the roster decide instead.
 */
function renderBody(message: CommMessage): string {
  const body = message.body.trim();
  if (body !== '') return body;
  return message.has_attachments ? IMAGE_PLACEHOLDER : NO_TEXT_PLACEHOLDER;
}

/**
 * What a resolved sender's priority says beside their name. `normal` says nothing: that priority
 * exists so a handle resolves to a NAME, and marking it would read as a judgment the owner never
 * made.
 */
const SENDER_MARKER: Partial<Record<PersonPriority, string>> = {
  high: '[priority person]',
  low: '[low priority person]',
};

/** `Dana Whitfield <dana@realplay.co> [priority person]`, resolved against the roster. */
function renderSender(message: CommMessage, people: readonly CommPerson[]): string {
  const person = resolveSender(message.sender_handle, people);
  const name = person?.name ?? message.sender_name;
  const who = name === undefined ? message.sender_handle : `${name} <${message.sender_handle}>`;
  const marker = person === undefined ? undefined : SENDER_MARKER[person.priority];
  return marker === undefined ? who : `${who} ${marker}`;
}

function buildUserMessage(input: CommsRequestInput): string {
  const { message, account, people, timeZone, now } = input;
  const today = referenceDate(timeZone, now);

  const lines = [
    `Account: ${account.label} (${account.kind})`,
    `From: ${renderSender(message, people)}`,
  ];
  if (message.chat_name !== undefined && message.chat_name !== '') {
    lines.push(
      `Group chat: ${message.chat_name} — participants: ${message.participants.join(', ')}`,
    );
  }
  if (message.subject !== undefined && message.subject !== '') {
    lines.push(`Subject: ${message.subject}`);
  }
  lines.push(
    `Received: ${renderStamp(message.received_at, timeZone)}`,
    `Today is ${today.weekday}, ${today.date}, in the owner's local time zone — resolve any day ` +
      'or deadline the message names against that.',
    'Message:',
    renderBody(message),
  );
  return lines.join('\n');
}

/**
 * Assemble one message's request: the system prompt (instructions, tiers, rules, rubric,
 * examples, roster), the message itself, and the fixed verdict schema.
 *
 * `examples` is the FINISHED selection rather than the raw window: the draw is per-tick and this
 * is per-message, so running it again here would apply it twice to every request.
 */
export function buildCommsRequest(input: CommsRequestInput): ClassifyRequest {
  return {
    system: buildSystemPrompt(input),
    user: buildUserMessage(input),
    schema: COMM_VERDICT_SCHEMA,
  };
}
