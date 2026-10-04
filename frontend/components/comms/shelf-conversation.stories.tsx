import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { groupConversations } from '@/lib/comms';
import { makeCommAccount, makeCommMessage } from '@/lib/comms/fixtures';
import type { CommMessage } from '@/lib/types';

import { MessageRow } from './message-row';
import { ShelfConversation } from './shelf-conversation';

/**
 * A shelf conversation — an email thread of four, one of them refused — collapsed and opened.
 * Collapsed, the refusal inside still shows on its face; opened, its messages are full shelf rows,
 * newest first, indented under the conversation.
 */

const NOW = new Date(2026, 8, 9, 12, 0);

const ACCOUNT = makeCommAccount('Personal Gmail', { id: 'acct-personal', kind: 'gmail' });

function reply(id: string, overrides: Partial<CommMessage>): CommMessage {
  return makeCommMessage(ACCOUNT.id, {
    id,
    thread_key: 'potluck',
    tier: 'fyi',
    judged_by: 'model',
    ...overrides,
  });
}

const THREAD = [
  reply('m-dana-2', {
    sender_handle: 'dana@example.com',
    sender_name: 'Dana Whitfield',
    subject: 'Re: Saturday potluck — final headcount',
    received_at: new Date(2026, 8, 9, 11, 40).toISOString(),
  }),
  reply('m-ana', {
    sender_handle: 'ana@example.com',
    sender_name: 'Ana Ruiz',
    subject: 'Re: Saturday potluck',
    judged_by: 'refusal',
    received_at: new Date(2026, 8, 9, 10, 31).toISOString(),
  }),
  reply('m-lee', {
    sender_handle: 'lee@example.com',
    sender_name: 'Lee Park',
    subject: 'Re: Saturday potluck — count me in, +1',
    received_at: new Date(2026, 8, 9, 8, 12).toISOString(),
  }),
  reply('m-dana-1', {
    sender_handle: 'dana@example.com',
    sender_name: 'Dana Whitfield',
    subject: 'Saturday potluck — who’s in?',
    received_at: new Date(2026, 8, 8, 18, 5).toISOString(),
  }),
];

function onlyConversation() {
  const [conversation] = groupConversations(THREAD, [ACCOUNT]);
  if (conversation === undefined) throw new Error('the thread groups into one conversation');
  return conversation;
}

const CONVERSATION = onlyConversation();

/** The conversation the way the view composes it: open state held above, rows passed in. */
function Composed({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = React.useState(initiallyOpen);
  return (
    <ShelfConversation
      conversation={CONVERSATION}
      account={ACCOUNT}
      accountLabel={ACCOUNT.label}
      people={[]}
      now={NOW}
      open={open}
      onToggle={() => {
        setOpen((current) => !current);
      }}
    >
      {CONVERSATION.messages.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          account={ACCOUNT}
          accountLabel={ACCOUNT.label}
          people={[]}
          verdict={undefined}
          now={NOW}
          selected={false}
          onSelect={() => {
            // Selection belongs to the view; the isolated conversation has none.
          }}
          onAddSender={() => {
            // No dialog in an isolated conversation story.
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
  component: Composed,
  decorators: [withFrame],
  args: { initiallyOpen: false },
  parameters: {
    store: { comms: { accounts: [ACCOUNT] } },
    visualTest: { target: '[data-testid="conversation-frame"]' },
  },
} satisfies Meta<typeof Composed>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Collapsed: who, the newest line attributed, "· 4 messages" as text, and the refusal inside. */
export const Collapsed: Story = {};

/** Opened by a click on its header — and closed again by a second. */
export const Opened: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvas.getByRole('button', { name: /4 messages/ });

    await userEvent.click(header);
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(header);
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(header);
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await canvas.findByRole('button', { name: /^Ana Ruiz/ });
  },
};
