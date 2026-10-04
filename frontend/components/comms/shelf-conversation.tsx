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
import { RolledUpMarkers } from './row-markers';

/**
 * A shelf conversation of two or more messages, collapsed to one row: who it is with, the newest
 * message's line, and how many messages it holds — a sentence in the meta line rather than a
 * badge, since the shelf is unbadged so that nothing on it reads as debt.
 *
 * Collapsing must never hide a warning, so the header carries every chip its messages do,
 * rolled up and counted.
 *
 * It holds no open state of its own. A conversation is open exactly while it, or one of its
 * messages, is the view's selected row — the same gesture that opens a message row's detail — so
 * only one is ever open and `j`/`k` need no second notion of "open". Its messages arrive as
 * `children`, so the view keeps owning how a row renders. A header has no verbs: those belong to
 * messages, and the view attaches none to it.
 */

interface ShelfConversationProperties {
  conversation: Conversation;
  /** The account it arrived on; `undefined` only if the account row has gone missing. */
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
  const listId = React.useId();
  const { messages, newest } = conversation;

  return (
    <div data-testid="comms-conversation">
      <div className={rowShellClass(selected, true)}>
        <ClickableCard
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            // A click toggles, like a row: the header opens the conversation and closes it again.
            onSelect(selected ? null : conversation.id);
          }}
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={rowSenderClass}>
              {conversationWho(messages, account?.kind, people)}
            </span>
            <span className={rowMetaClass}>
              · {accountLabel} · {formatMessageTime(newest.received_at, now)} ·{' '}
              {String(messages.length)} messages
            </span>
          </div>
          <p className={rowAskClass}>{conversationLine(messages, people)}</p>
          <div className="mt-1.5">
            <RolledUpMarkers messages={messages} people={people} now={now} />
          </div>
        </ClickableCard>
      </div>

      <AnimatedHeightCollapse open={open} testId="comms-conversation-messages">
        <div id={listId} className={conversationKidsClass}>
          {children}
        </div>
      </AnimatedHeightCollapse>
    </div>
  );
}
