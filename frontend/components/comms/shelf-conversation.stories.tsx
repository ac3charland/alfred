import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { groupConversations } from '@/lib/comms';
import { makeCommAccount, makeCommMessage } from '@/lib/comms/fixtures';
import type { CommMessage } from '@/lib/types';

import { MessageRow } from './message-row';
import { ShelfConversation } from './shelf-conversation';

/**
 * One shelf conversation, collapsed and opened: the who-line, the newest line prefixed with its
 * sender, the message count in prose, and the chips rolled up from inside — here a refused reply
 * and two unreadable attachments, counted.
 */

const NOW = new Date(2026, 8, 9, 12, 0);
const ACCOUNT = makeCommAccount('Personal Gmail', { id: 'acct-personal', kind: 'gmail' });

function message(overrides: Partial<CommMessage>): CommMessage {
  return makeCommMessage(ACCOUNT.id, {
    thread_key: 'potluck',
    tier: 'fyi',
    judged_by: 'model',
    ...overrides,
  });
}

const [CONVERSATION] = groupConversations(
  [
    message({
      id: 'potluck-4',
      sender_handle: 'dana@example.com',
      sender_name: 'Dana Whitfield',
      subject: 'Re: Saturday potluck — final headcount',
      received_at: new Date(2026, 8, 9, 11, 40).toISOString(),
    }),
    message({
      id: 'potluck-3',
      judged_by: 'refusal',
      sender_handle: 'ana@example.com',
      sender_name: 'Ana Ruiz',
      subject: 'Re: Saturday potluck',
      has_attachments: true,
      received_at: new Date(2026, 8, 9, 10, 31).toISOString(),
    }),
    message({
      id: 'potluck-2',
      sender_handle: 'lee@example.com',
      sender_name: 'Lee Park',
      subject: 'Re: Saturday potluck — count me in, +1',
      has_attachments: true,
      received_at: new Date(2026, 8, 9, 8, 12).toISOString(),
    }),
    message({
      id: 'potluck-1',
      sender_handle: 'dana@example.com',
      sender_name: 'Dana Whitfield',
      subject: "Saturday potluck — who's in?",
      received_at: new Date(2026, 8, 8, 18, 0).toISOString(),
    }),
  ],
  [ACCOUNT],
);

/** The view's part, in miniature: one selection, which is what opens the conversation. */
function Harness({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const conversation = CONVERSATION;
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initiallyOpen && conversation !== undefined ? conversation.id : null,
  );
  if (conversation === undefined) return null;
  const open =
    selectedId === conversation.id ||
    conversation.messages.some((inside) => inside.id === selectedId);
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
      {conversation.messages.map((inside) => (
        <MessageRow
          key={inside.id}
          message={inside}
          account={ACCOUNT}
          accountLabel={ACCOUNT.label}
          people={[]}
          verdict={undefined}
          now={NOW}
          selected={selectedId === inside.id}
          onSelect={setSelectedId}
          onAddSender={() => {
            // No roster dialog in an isolated conversation story.
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
  parameters: {
    store: { comms: { accounts: [ACCOUNT] }, commsSettings: { people: [] } },
  },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Collapsed: one row for four messages, the refusal and the unread attachments rolled up. */
export const Collapsed: Story = {
  parameters: { visualTest: { target: '[data-testid="conversation-frame"]' } },
  play: async ({ canvasElement }) => {
    const header = within(canvasElement).getByRole('button', { name: /4 messages/ });
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(header).toHaveTextContent('Attachment · not read · 2');
    await expect(header).toHaveTextContent('Refused');
  },
};

/** Opened: its messages as full shelf rows, newest first, indented under a rule. */
export const Open: Story = {
  args: { initiallyOpen: true },
  parameters: { visualTest: { target: '[data-testid="conversation-frame"]' } },
};

/** A click opens it and the next closes it — the same gesture as any row. */
export const Toggles: Story = {
  play: async ({ canvasElement }) => {
    const header = within(canvasElement).getByRole('button', { name: /4 messages/ });
    await userEvent.click(header);
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(header);
    await expect(header).toHaveAttribute('aria-expanded', 'false');
  },
};
