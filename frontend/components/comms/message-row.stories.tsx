import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';

import { makeCommAccount, makeCommMessage, makeCommVerdict } from '@/lib/comms/fixtures';
import type { CommMessage, CommPersonWithHandles } from '@/lib/types';

import { MessageRow } from './message-row';

/**
 * The row in each of the states that says alfred might be wrong about it.
 *
 * Every chip here names a different failure the module has to admit to on the row's own face —
 * a sender the roster made important, a message nothing judged, an attachment nothing could
 * read, a row about to be swept, and the two states only the shelf can hold. None of them can
 * be produced on demand from real data, which is exactly why they are drawn here.
 */

const NOW = new Date(2026, 8, 9, 12, 0);
const DAY = 24 * 60 * 60 * 1000;

const ACCOUNT = makeCommAccount('RealPlay', { id: 'acct-realplay', kind: 'gmail' });

const DANA: CommPersonWithHandles = {
  id: 'p-dana',
  name: 'Dana Whitfield',
  priority: 'high',
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  comm_handles: [
    {
      id: 'p-dana-h',
      person_id: 'p-dana',
      handle: 'dana@realplay.example',
      kind: 'email',
      created_at: '2026-01-01T00:00:00Z',
    },
  ],
};

function row(overrides: Partial<CommMessage> = {}): CommMessage {
  return makeCommMessage(ACCOUNT.id, {
    id: 'm-1',
    tier: 'today',
    judged_by: 'model',
    sender_handle: 'dana@realplay.example',
    sender_name: 'Dana W.',
    subject: 'Q3 invoice',
    body: 'Can you approve the Q3 invoice before the 5pm billing run?',
    ask: 'Needs the Q3 invoice approved before the 5pm billing run.',
    rfc822_message_id: '<q3-invoice-99@realplay.example>',
    received_at: new Date(2026, 8, 9, 9, 14).toISOString(),
    ...overrides,
  });
}

const withFrame: Decorator = (Story) => (
  <div data-testid="row-frame" className="w-[620px] bg-background p-2">
    <Story />
  </div>
);

const meta = {
  title: 'Comms/MessageRow',
  component: MessageRow,
  decorators: [withFrame],
  args: {
    message: row(),
    account: ACCOUNT,
    accountLabel: 'RealPlay',
    people: [DANA],
    verdict: makeCommVerdict('m-1', {
      reason: 'Dana is on the priority roster and named a hard deadline today.',
    }),
    now: NOW,
    selected: false,
    onSelect: () => {
      // The story pins selection through `args`, so a click here changes nothing.
    },
    onAddSender: () => {
      // No dialog in an isolated row story.
    },
  },
  parameters: {
    store: { comms: { accounts: [ACCOUNT] }, commsSettings: { people: [DANA] } },
  },
} satisfies Meta<typeof MessageRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An ordinary judged row from someone on the roster. */
export const PriorityPerson: Story = {
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** Nobody the roster knows: the same row, with nothing claimed about the sender. */
export const Plain: Story = {
  args: {
    message: row({ sender_handle: 'noreply@example.com', sender_name: 'Northwind Billing' }),
    people: [],
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** Five attempts, none usable — queued anyway, because unknown is not nothing. */
export const Unjudged: Story = {
  args: {
    message: row({
      judged_by: 'unjudged',
      classify_attempts: 5,
      sender_name: null,
      sender_handle: 'billing@northwind.co',
      ask: 'Not judged — five attempts, none of them usable. Treated as owed until it can be read.',
    }),
    people: [],
    verdict: undefined,
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** A photo and no text from someone who matters: classified on the sender, flagged as unread. */
export const AttachmentNotRead: Story = {
  args: {
    message: row({
      body: '',
      has_attachments: true,
      subject: null,
      ask: 'A photo and no text, from a priority person — queued on that basis. alfred can’t read what it’s asking. Open it.',
    }),
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** Fifty-five days old and still owed: the sweep takes it in five, marker or no marker. */
export const ExpiringSoon: Story = {
  args: {
    message: row({
      tier: 'whenever',
      received_at: new Date(NOW.getTime() - 55 * DAY + 2 * 60 * 60 * 1000).toISOString(),
      sender_name: 'Jae-won Sohn',
      sender_handle: 'jaewon@example.com',
      ask: 'Wants your notes on the draft before he circulates it. No date named.',
    }),
    people: [],
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** Two states only the shelf holds: the model declined to judge it, and a header filter shelved it. */
export const RefusedAndFiltered: Story = {
  args: {
    message: row({
      tier: 'fyi',
      judged_by: 'refusal',
      filtered_reason: 'newsletter',
      sender_name: null,
      sender_handle: 'news@example.com',
      ask: null,
      subject: 'This week in widgets',
    }),
    people: [],
    verdict: undefined,
    shelved: true,
  },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};

/** Selected: the message, the reason it landed here, and the five verbs. */
export const Selected: Story = {
  args: { selected: true },
  parameters: { visualTest: { target: '[data-testid="row-frame"]' } },
};
