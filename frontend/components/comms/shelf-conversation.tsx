'use client';

import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { ClickableCard } from '@/components/atoms/clickable-card';
import type { ShelfConversation as Conversation } from '@/lib/comms';
import type { CommAccount, CommPersonWithHandles } from '@/lib/types';

import { conversationLine, conversationWho, formatMessageTime } from './comms-format';
import {
  conversationKidsClass,
  rowAskClass,
  rowMetaClass,
  rowSenderClass,
  rowShellClass,
} from './message-row.styles';
import { ConversationMarkers } from './row-markers';

/**
 * A shelf conversation of two or more messages, collapsed to one row: who it's with, its newest
 * line, how many messages, and every chip any of them carries. Opening it reveals the messages
 * themselves as full shelf rows (passed in as `children`, so the view keeps owning how a row is
 * drawn), each still with its own tier picker — verbs belong to messages, never to the thread.
 *
 * It has no open state of its own. It is open exactly while it, or one of its messages, is the
 * view's selected row, so `j`/`k` walking into it opens it and walking past it closes it, and only
 * one conversation is ever open — the same select-to-expand gesture every row already has.
 */

interface ShelfConversationProperties {
  conversation: Conversation;
  account: CommAccount | undefined;
  accountLabel: string;
  people: CommPersonWithHandles[];
  now: Date;
  /** The header itself is the selected row. */
  selected: boolean;
  /** The header or one of its messages is selected. */
  open: boolean;
  /** Select the header, or clear the selection entirely. */
  onSelect: (id: string | null) => void;
  /** The conversation's message rows, newest first. */
  children: React.ReactNode;
}

export function ShelfConversation({
  conversation,
  account,
  accountLabel,
  people,
  now,
  selected,
  open,
  onSelect,
  children,
}: ShelfConversationProperties) {
  const kidsId = React.useId();
  const { messages, newest } = conversation;
  // A long thread's rows are mounted only once it is first opened, like the shelf's own.
  const [everOpened, setEverOpened] = React.useState(open);
  if (open && !everOpened) setEverOpened(true);

  return (
    <div data-testid="shelf-conversation">
      <div className={rowShellClass(selected, true)}>
        <ClickableCard
          aria-expanded={open}
          aria-controls={kidsId}
          onClick={() => {
            // An open conversation closes on a click wherever the selection sits inside it; a
            // closed one opens onto its header.
            onSelect(open ? null : conversation.id);
          }}
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={rowSenderClass}>{conversationWho(messages, account, people)}</span>
            <span className={rowMetaClass}>
              · {accountLabel} · {formatMessageTime(newest.received_at, now)} ·{' '}
              {String(messages.length)} messages
            </span>
          </div>
          <p className={rowAskClass}>{conversationLine(messages, people)}</p>
          <div className="mt-1.5">
            <ConversationMarkers messages={messages} people={people} now={now} />
          </div>
        </ClickableCard>
      </div>

      <AnimatedHeightCollapse open={open} testId="shelf-conversation-collapse">
        <div id={kidsId} className={conversationKidsClass}>
          {everOpened && children}
        </div>
      </AnimatedHeightCollapse>
    </div>
  );
}
