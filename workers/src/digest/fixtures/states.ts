/**
 * The digest's four reference states, as facts: what a normal Saturday, a Saturday with no model,
 * a Saturday with no plan, and a quiet Sunday each look like. Shared by `format.test.ts` and
 * `scripts/digest-preview.ts`, so the demo prints exactly what the suite pins.
 *
 * Every name and line is invented. `planHtml` is `weekly-plan.html` next door, passed in so this
 * module needs no file access.
 */
import type { DigestTaskRow } from '../due';
import type { DigestAsk, DigestFacts } from '../facts';

const WIRE_NULL = JSON.parse('null') as null;

/** 07:00 CST on Saturday, Nov 7 2026, and on the Sunday after. */
export const SATURDAY = new Date('2026-11-07T13:00:00Z');
export const SUNDAY = new Date('2026-11-08T13:00:00Z');
export const ZONE = 'America/Chicago';
export const APP_URL = 'https://alfred-six-gamma.vercel.app';

let created = 0;
export function task(title: string, fields: Partial<DigestTaskRow> = {}): DigestTaskRow {
  created += 1;
  return {
    id: fields.id ?? title,
    parent_id: fields.parent_id ?? WIRE_NULL,
    title,
    status: fields.status ?? 'active',
    priority: fields.priority ?? WIRE_NULL,
    due_date: fields.due_date ?? WIRE_NULL,
    due_time: fields.due_time ?? WIRE_NULL,
    created_at: fields.created_at ?? `2026-10-${String(10 + (created % 20))}T00:00:00Z`,
  };
}

export function ask(tier: 'asap' | 'today', sender: string, text: string): DigestAsk {
  return { tier, sender, account: 'iMessage', ask: text, received_at: '2026-11-07T12:00:00Z' };
}

export function plan(html: string): NonNullable<DigestFacts['plan']> {
  return { id: 'plan-1', uploaded_at: '2026-11-06T22:00:00Z', html };
}

export function normalFacts(planHtml: string): DigestFacts {
  return {
    tasks: [
      task('Send RealPlay October invoice', {
        due_date: '2026-11-05',
        created_at: '2026-10-01T00:00:00Z',
      }),
      task('Plan Motivic beta', {
        id: 'beta',
        due_date: '2026-11-12',
        created_at: '2026-10-02T00:00:00Z',
      }),
      task('Write the beta invite', { parent_id: 'beta', due_date: '2026-11-06' }),
      task('Call the dentist about the crown', { due_date: '2026-11-07', due_time: '15:00:00' }),
      task('Draft Motivic chord-voicing notes', {
        due_date: '2026-11-07',
        priority: 'high',
        created_at: '2026-10-03T00:00:00Z',
      }),
      task('Pick a post-show bedtime', {
        due_date: '2026-11-07',
        created_at: '2026-10-04T00:00:00Z',
      }),
      task('Not yet', { due_date: '2026-11-09' }),
    ],
    comms: {
      counts: { asap: 1, today: 2, whenever: 6 },
      asks: [
        ask('asap', 'Dana', 'Can you confirm Thursday’s rehearsal time?'),
        ask('today', 'Chad', 'Wants your read on the 2.4 release notes.'),
        ask('today', 'Mom', 'Asks whether you’re coming Sunday.'),
      ],
    },
    reader_waiting: 12,
    plan: plan(planHtml),
  };
}

export function noPlanFacts(planHtml: string): DigestFacts {
  return {
    ...normalFacts(planHtml),
    tasks: [
      task('Send RealPlay October invoice', { due_date: '2026-11-05' }),
      task('Call the dentist about the crown', { due_date: '2026-11-07', due_time: '15:00:00' }),
    ],
    comms: {
      counts: { asap: 1, today: 0, whenever: 6 },
      asks: [ask('asap', 'Dana', 'Can you confirm Thursday’s rehearsal time?')],
    },
    plan: WIRE_NULL,
  };
}

export function quietFacts(planHtml: string): DigestFacts {
  return {
    tasks: [],
    comms: { counts: { asap: 0, today: 0, whenever: 0 }, asks: [] },
    reader_waiting: 0,
    plan: plan(planHtml),
  };
}

/** One reference state: the facts, the instant, and the opener a model would have written. */
export interface DigestState {
  facts: DigestFacts;
  now: Date;
  opener: string | undefined;
}

export const OPENERS = {
  normal:
    'Long-run day, so the shape is: clear Dana’s rehearsal question first, then finish the RealPlay invoice that slipped Thursday before you head out. The Motivic notes are the week’s Rock 1 thread — an hour this afternoon keeps the win condition in reach.',
  noPlan:
    'No week plan covers today, so the list below is the whole picture: the invoice is two days late and Dana is waiting on you — those two first.',
  quiet: 'Nothing is due and no one is waiting on you. The plan has today as a rest day — take it.',
} as const;

export function digestStates(planHtml: string): Record<string, DigestState> {
  return {
    normal: { facts: normalFacts(planHtml), now: SATURDAY, opener: OPENERS.normal },
    'model-unavailable': { facts: normalFacts(planHtml), now: SATURDAY, opener: undefined },
    'no-plan': { facts: noPlanFacts(planHtml), now: SATURDAY, opener: OPENERS.noPlan },
    quiet: { facts: quietFacts(planHtml), now: SUNDAY, opener: OPENERS.quiet },
  };
}
