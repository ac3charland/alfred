import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { groupConversations } from '@/lib/comms';
import { makeCommAccount, makeCommMessage } from '@/lib/comms/fixtures';
import type { CommMessage } from '@/lib/types';

import { MessageRow } from './message-row';
import { ShelfConversation } from './shelf-conversation';

/**
 * A shelf conversation collapsed to one row, and opened onto its messages.
 *
 * The collapsed row is the one that has to earn its keep: who, the newest line attributed to its
 * sender, the size as a sentence, and every chip its messages carry — the refused reply and the
 * two unreadable photos must survive the collapse, or collapsing has hidden a warning.
 */

const NOW = new Date(2026, 8, 9, 12, 0);
const ACCOUNT = makeCommAccount('Personal Gmail', { id: 'acct-personal', kind: 'gmail' });

function message(id: string, hour: number, overrides: Partial<CommMessage>): CommMessage {
  return makeCommMessage(ACCOUNT.id, {
    id,
    thread_key: 'potluck',
    tier: 'fyi',
    judged_by: 'model',
    received_at: new Date(2026, 8, 9, hour, 0).toISOString(),
    ...overrides,
  });
}

const POTLUCK = [
  message('m-4', 11, {
    sender_handle: 'dana@example.com',
    sender_name: 'Dana Whitfield',
    subject: 'Re: Saturday potluck — final headcount',
  }),
  message('m-3', 10, {
    sender_handle: 'ana@example.com',
    sender_name: 'Ana Ruiz',
    subject: 'Re: Saturday potluck',
    judged_by: 'refusal',
  }),
  message('m-2', 9, {
    sender_handle: 'lee@example.com',
    sender_name: 'Lee Park',
    subject: 'Re: Saturday potluck — photos',
    has_attachments: true,
  }),
  message('m-1', 8, {
    sender_handle: 'dana@example.com',
    sender_name: 'Dana Whitfield',
    subject: "Saturday potluck — who's in?",
    has_attachments: true,
  }),
];

/** The view's job in miniature: one selection, which the conversation opens around. */
function Harness() {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [conversation] = groupConversations(POTLUCK, [ACCOUNT]);
  if (conversation === undefined) return null;
  const open =
    selectedId === conversation.id || conversation.messages.some((row) => row.id === selectedId);
  return (
    <ShelfConversation
      conversation={conversation}
      account={ACCOUNT}
      accountLabel={ACCOUNT.label}
      people={[]}
      now={NOW}
      selected={selectedId === conversation.id}
      open={open}
      onSelect={setSelectedId}
    >
      {conversation.messages.map((row) => (
        <MessageRow
          key={row.id}
          message={row}
          account={ACCOUNT}
          accountLabel={ACCOUNT.label}
          people={[]}
          verdict={undefined}
          now={NOW}
          selected={selectedId === row.id}
          onSelect={setSelectedId}
          onAddSender={() => {
            // Not exercised here: the roster dialog belongs to the view.
          }}
          shelved
        />
      ))}
    </ShelfConversation>
  );
}

const withFrame: Decorator = (Story) => (
  <div data-testid="conversation-frame" className="w-[620px] bg-background p-2">
    <Story />
  </div>
);

const meta = {
  title: 'Comms/ShelfConversation',
  component: Harness,
  decorators: [withFrame],
  parameters: { visualTest: { target: '[data-testid="conversation-frame"]' } },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Collapsed: four messages, three senders, one refused and two photos nothing could read. */
export const Collapsed: Story = {};

/** Opened by selecting it: its messages as full shelf rows, indented, newest first. */
export const Opened: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvas.getByRole('button', { expanded: false, name: /4 messages/ });

    await userEvent.click(header);
    await expect(header).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(header);
    await expect(header).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(header);
    await expect(header).toHaveAttribute('aria-expanded', 'true');
  },
};
