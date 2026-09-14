import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import { userEvent, within } from 'storybook/test';

import {
  makeCommAccount,
  makeCommHealth,
  makeCommMessage,
  makeCommVerdict,
} from '@/lib/comms/fixtures';
import type { CommMessage, CommPersonWithHandles, CommVerdict } from '@/lib/types';

import { CommsQueueView } from './comms-queue-view';

/**
 * The two pictures the epic draws: a deliberately bad day, with every failure surface the module
 * asserts drawn at once, and the resting state it exists to produce.
 *
 * Both are snapshotted, because most of what they show cannot be produced on demand from real
 * data — a stalled classifier, a rejected token, a message nothing could judge, a row five days
 * from deletion — and a surface no test can reach is a surface that silently rots.
 *
 * Every instant is built from LOCAL calendar parts against a PINNED `now`, and the view is given
 * that same `now`, so the rendered clock times and "3h ago" strings are identical in every
 * timezone and on every day the suite runs.
 */

const NOW = new Date(2026, 8, 9, 12, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An instant this many milliseconds before the pinned `now`. */
const ago = (millis: number): string => new Date(NOW.getTime() - millis).toISOString();
/** A clock time earlier today, so the row's time column reads as the mockup draws it. */
const todayAt = (hour: number, minute: number): string =>
  new Date(2026, 8, 9, hour, minute).toISOString();

const PERSONAL = makeCommAccount('personal', {
  id: 'acct-personal',
  kind: 'gmail',
  last_seen_at: ago(2 * MINUTE),
});

const REALPLAY_LIVE = makeCommAccount('RealPlay', {
  id: 'acct-realplay',
  kind: 'gmail',
  last_seen_at: ago(3 * MINUTE),
});

/** Polls are running and being refused — the account is dead, not quiet. */
const REALPLAY_ERRORING = makeCommAccount('RealPlay', {
  id: 'acct-realplay',
  kind: 'gmail',
  last_seen_at: ago(4 * HOUR),
  last_error: 'the refresh token was rejected',
  last_error_at: ago(40 * MINUTE),
});

const WORKMAIL_LIVE = makeCommAccount('WorkMail', {
  id: 'acct-workmail',
  kind: 'imap',
  home: 'daemon',
  expected_interval_seconds: 900,
  last_seen_at: ago(4 * MINUTE),
});

const WORKMAIL_ASLEEP = makeCommAccount('WorkMail', {
  id: 'acct-workmail',
  kind: 'imap',
  home: 'daemon',
  expected_interval_seconds: 900,
  last_seen_at: ago(3 * HOUR),
});

const IMESSAGE_LIVE = makeCommAccount('iMessage', {
  id: 'acct-imessage',
  kind: 'imessage',
  home: 'daemon',
  expected_interval_seconds: 900,
  last_seen_at: ago(5 * MINUTE),
});

/** The same two Worker-polled mailboxes as the tab last heard about them, hours ago. */
const PERSONAL_STALE = makeCommAccount('personal', {
  id: 'acct-personal',
  kind: 'gmail',
  last_seen_at: ago(3 * HOUR),
});

const REALPLAY_STALE = makeCommAccount('RealPlay', {
  id: 'acct-realplay',
  kind: 'gmail',
  last_seen_at: ago(3 * HOUR),
});

const IMESSAGE_ASLEEP = makeCommAccount('iMessage', {
  id: 'acct-imessage',
  kind: 'imessage',
  home: 'daemon',
  expected_interval_seconds: 900,
  last_seen_at: ago(3 * HOUR),
});

function person(
  id: string,
  name: string,
  handle: string,
  priority: CommPersonWithHandles['priority'] = 'high',
): CommPersonWithHandles {
  return {
    id,
    name,
    priority,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    comm_handles: [
      {
        id: `${id}-h`,
        person_id: id,
        handle,
        kind: handle.includes('@') ? 'email' : 'phone',
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
  };
}

const ROSTER = [
  person('p-dana', 'Dana Whitfield', 'dana@realplay.example'),
  person('p-tomas', 'Tomas Berg', '+15550102233'),
];

const VERDICTS: CommVerdict[] = [];

/** A judged row, with the verdict that explains it — the "Why:" line the detail shows. */
function judged(accountId: string, overrides: Partial<CommMessage>, reason: string): CommMessage {
  const verdict = makeCommVerdict('pending', { reason, tier: overrides.tier ?? 'today' });
  const message = makeCommMessage(accountId, {
    judged_by: 'model',
    verdict_id: verdict.id,
    ...overrides,
  });
  VERDICTS.push({ ...verdict, message_id: message.id });
  return message;
}

const ASAP_ROW = judged(
  REALPLAY_ERRORING.id,
  {
    id: 'm-dana',
    tier: 'asap',
    sender_handle: 'dana@realplay.example',
    sender_name: 'Dana Whitfield',
    subject: 'Q3 invoice — approval needed',
    body: 'The billing run goes out at 5pm and the Q3 invoice is still unapproved. Can you take a look before then?',
    ask: 'Needs the Q3 invoice approved before the 5pm billing run.',
    rfc822_message_id: '<q3-invoice-99@realplay.example>',
    received_at: todayAt(9, 14),
  },
  'Dana is on the priority roster and named a hard deadline today.',
);

const TODAY_ROWS = [
  judged(
    IMESSAGE_ASLEEP.id,
    {
      id: 'm-mom',
      tier: 'today',
      sender_handle: '+15550119876',
      sender_name: 'Mom',
      body: 'Are you coming Sunday? Need to know for the table.',
      ask: 'Asking whether you’re coming Sunday — wants a yes or no.',
      received_at: todayAt(8, 2),
    },
    'A direct question with a yes-or-no answer, and no stated deadline beyond Sunday.',
  ),
  judged(
    PERSONAL.id,
    {
      id: 'm-priya',
      tier: 'today',
      sender_handle: 'priya@example.com',
      sender_name: 'Priya Raghavan',
      subject: 'Thursday walkthrough',
      body: 'Let me know what times work for the Thursday walkthrough and I’ll book the room.',
      ask: 'Waiting on your availability for the Thursday walkthrough.',
      rfc822_message_id: '<walkthrough-4@example.com>',
      received_at: new Date(2026, 8, 8, 16, 40).toISOString(),
    },
    'She is blocked on an answer to schedule the session.',
  ),
  // The other half of the can't-read rule: classified WITH the attachment named, and queued on
  // the strength of who sent it rather than on anything alfred could read.
  judged(
    IMESSAGE_ASLEEP.id,
    {
      id: 'm-tomas',
      tier: 'today',
      sender_handle: '+15550102233',
      sender_name: 'Tomas Berg',
      body: '',
      has_attachments: true,
      ask: 'A photo and no text, from a priority person — queued on that basis. alfred can’t read what it’s asking. Open it.',
      received_at: todayAt(8, 41),
    },
    'No readable text; the sender is on the priority roster, so it is queued rather than shelved.',
  ),
  // Nothing judged this at all: the ceiling was reached, and unknown is not nothing.
  makeCommMessage(REALPLAY_ERRORING.id, {
    id: 'm-billing',
    tier: 'today',
    judged_by: 'unjudged',
    classify_attempts: 5,
    sender_handle: 'billing@northwind.co',
    sender_name: null,
    subject: 'Statement 4471',
    body: 'Statement attached.',
    ask: 'Not judged — five attempts, none of them usable. Treated as owed until it can be read.',
    rfc822_message_id: '<statement-4471@northwind.co>',
    received_at: todayAt(7, 55),
  }),
];

const MARCUS = judged(
  PERSONAL.id,
  {
    id: 'm-marcus',
    tier: 'whenever',
    sender_handle: 'marcus@example.com',
    sender_name: 'Marcus Okonkwo',
    subject: 'Intro?',
    body: 'Any chance you could introduce me to someone on the platform team? No rush at all.',
    ask: 'Asked for an intro to someone on the platform team. No deadline given.',
    rfc822_message_id: '<intro-12@example.com>',
    received_at: new Date(2026, 7, 19, 11, 5).toISOString(),
  },
  'A real request with no date attached, so it is owed but undated.',
);

/** Fifty-five days old: inside the last week of its sixty, and still owed. */
const EXPIRING = judged(
  PERSONAL.id,
  {
    id: 'm-jaewon',
    tier: 'whenever',
    sender_handle: 'jaewon@example.com',
    sender_name: 'Jae-won Sohn',
    subject: 'Draft',
    body: 'Would love your notes on the draft before I circulate it more widely.',
    ask: 'Wants your notes on the draft before he circulates it. No date named.',
    rfc822_message_id: '<draft-7@example.com>',
    received_at: new Date(NOW.getTime() - 55 * DAY + 2 * HOUR).toISOString(),
  },
  'A request with no date attached.',
);

/**
 * The shelf, at the size sixty days of FYI actually reaches. Seeded in full rather than
 * faked, because the number in the summary line IS the shelf's length — and because the
 * collapsed shelf mounting none of them is the thing worth proving at this size.
 */
function shelfRows(count: number): CommMessage[] {
  return Array.from({ length: count }, (_, index) =>
    makeCommMessage(PERSONAL.id, {
      id: `shelf-${String(index)}`,
      tier: 'fyi',
      judged_by: 'model',
      sender_handle: `sender${String(index)}@example.com`,
      subject: 'Receipt',
      body: 'Your order has shipped.',
      ask: 'Nothing asked.',
      received_at: new Date(NOW.getTime() - (index + 1) * HOUR).toISOString(),
    }),
  );
}

/**
 * A week of iMessage history the owner had already answered before alfred ever saw it: inbound,
 * never judged, and cleared by the outbound reply that arrived in the same backfill.
 */
const ANSWERED_BACKFILL: CommMessage[] = Array.from({ length: 6 }, (_, index) =>
  makeCommMessage('acct-imessage', {
    id: `backfilled-${String(index)}`,
    sender_handle: '+15551230000',
    body: 'Answered days before alfred saw it.',
    received_at: ago((index + 1) * DAY),
    cleared_at: ago((index + 1) * DAY - HOUR),
    cleared_by: 'reply',
  }),
);

/** A fixed-width frame so the snapshot is a tight, deterministic crop of the module. */
const withFrame: Decorator = (Story) => (
  <div data-testid="comms-frame" className="w-[760px] bg-background">
    <Story />
  </div>
);

const meta = {
  title: 'Comms/CommsQueueView',
  component: CommsQueueView,
  decorators: [withFrame],
  args: { now: NOW },
} satisfies Meta<typeof CommsQueueView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shared by the still and the expanded-row story, so both draw the same day. */
const BAD_DAY_PARAMETERS = {
  store: {
    comms: {
      accounts: [PERSONAL, REALPLAY_ERRORING, WORKMAIL_ASLEEP, IMESSAGE_ASLEEP],
      messages: [ASAP_ROW, ...TODAY_ROWS, MARCUS, EXPIRING, ...shelfRows(2417)],
      verdicts: VERDICTS,
      health: makeCommHealth({
        last_run_at: ago(MINUTE),
        last_success_at: ago(3 * HOUR),
        last_error: 'anthropic: 529 overloaded',
        last_error_at: ago(2 * HOUR + 20 * MINUTE),
      }),
    },
    commsSettings: { people: ROSTER },
  },
  visualTest: { target: '[data-testid="comms-frame"]' },
};

/**
 * The bad day: one ASAP from a priority person, four on Today — including a photo-only
 * message alfred could not read and a row nothing judged at all — and two on Whenever, one
 * of them five days from the retention sweep. RealPlay's token has been rejected, the Mac is
 * asleep so both of its sources are stale, and the classifier itself has stopped judging.
 */
export const BadDay: Story = { parameters: BAD_DAY_PARAMETERS };

/**
 * The state the module exists to produce, reached by draining rather than by being empty:
 * ASAP and Today at zero, Whenever still holding the three-week-old row that
 * tier exists for, every dot green and no banner.
 */
export const Resting: Story = {
  parameters: {
    store: {
      comms: {
        accounts: [PERSONAL, REALPLAY_LIVE, WORKMAIL_LIVE, IMESSAGE_LIVE],
        messages: [MARCUS, ...shelfRows(2441)],
        verdicts: VERDICTS,
        health: makeCommHealth({ last_run_at: ago(MINUTE), last_success_at: ago(MINUTE) }),
      },
      commsSettings: { people: ROSTER },
    },
    visualTest: { target: '[data-testid="comms-frame"]' },
  },
};

/**
 * A backfill of threads the owner answered days ago, which is what the FIRST hour after the
 * classifier is switched on actually looks like. The daemon brings in a week of iMessage history,
 * the owner's own replies in it drain their threads on arrival, and those inbound rows are left
 * permanently unjudged — correctly, since the sweep never judges a row a reply already cleared.
 *
 * Every dot is green, judgment is working, and there must be NO classifier banner: reading those
 * rows as a queue nothing is judging reported an outage dated a week before the classifier had
 * been switched on at all.
 */
export const FreshlyActivated: Story = {
  parameters: {
    store: {
      comms: {
        accounts: [PERSONAL, REALPLAY_LIVE, WORKMAIL_LIVE, IMESSAGE_LIVE],
        messages: [MARCUS, ...ANSWERED_BACKFILL, ...shelfRows(2441)],
        verdicts: VERDICTS,
        health: makeCommHealth({ last_run_at: ago(MINUTE), last_success_at: ago(MINUTE) }),
      },
      commsSettings: { people: ROSTER },
    },
    visualTest: { target: '[data-testid="comms-frame"]' },
  },
};

/** The bad day with the ASAP row opened: the five verbs, the body, and the verdict's reason. */
export const RowExpanded: Story = {
  parameters: BAD_DAY_PARAMETERS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByText(ASAP_ROW.ask ?? ''));
    await canvas.findByRole('button', { name: 'Nothing to answer' });
  },
};

/**
 * A tab that has been left open. Every source is polling normally, but this tab's realtime
 * socket lapsed while the owner was elsewhere, so it is still holding the roster it was seeded
 * with hours ago — and because health is read against a ticking clock, that frozen roster has
 * decayed on its own into three amber dots accusing three healthy sources of having died.
 *
 * The story runs the real recovery (ALF-227): returning to the foreground makes the store
 * re-read `GET /api/comms/health`, which is stubbed here to answer what the pollers have
 * actually been doing. What is snapshotted is the state AFTER that re-read — every dot green,
 * every accusation withdrawn — so the pixels this fix exists to restore are gated.
 */
export const RecoversAfterTimeAway: Story = {
  decorators: [
    (Story) => {
      globalThis.fetch = (() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              accounts: [PERSONAL, REALPLAY_LIVE, WORKMAIL_LIVE, IMESSAGE_LIVE],
              health: makeCommHealth({ last_run_at: ago(MINUTE), last_success_at: ago(MINUTE) }),
            }),
        })) as unknown as typeof fetch;
      return <Story />;
    },
  ],
  parameters: {
    store: {
      comms: {
        // What the tab still holds: the seed it loaded with, hours stale on this clock.
        accounts: [PERSONAL_STALE, REALPLAY_STALE, WORKMAIL_ASLEEP, IMESSAGE_ASLEEP],
        messages: [MARCUS, ...shelfRows(2441)],
        verdicts: VERDICTS,
        health: makeCommHealth({ last_run_at: ago(3 * HOUR), last_success_at: ago(3 * HOUR) }),
      },
      commsSettings: { people: ROSTER },
    },
    visualTest: { target: '[data-testid="comms-frame"]' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByLabelText('personal · stale');

    // The tab comes back to the front — the signal the owner actually feels.
    document.dispatchEvent(new Event('visibilitychange'));

    await canvas.findByLabelText('personal · live');
    await canvas.findByLabelText('RealPlay · live');
    await canvas.findByLabelText('WorkMail · live');
    await canvas.findByLabelText('iMessage · live');
  },
};
