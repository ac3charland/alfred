'use client';

import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { ClickableCard } from '@/components/atoms/clickable-card';
import { type ShelfConversation as Conversation, rollUpMarkers } from '@/lib/comms';
import type { CommAccount, CommPersonWithHandles } from '@/lib/types';

import { conversationLine, conversationWho, formatMessageTime } from './comms-format';
import {
  conversationKidsClass,
  rowAskClass,
  rowAskSelectedClass,
  rowMetaClass,
  rowSenderClass,
  rowShellClass,
} from './message-row.styles';
import { RolledUpMarkers } from './row-markers';

/**
 * A shelf conversation of more than one message: an email thread, or one burst of an iMessage
 * chat. Collapsed, it reads as one row of the same two-line shape as any message — who, the
 * newest line, the count as meta text rather than a badge (the shelf is unbadged on purpose) —
 * plus every chip any of its messages carries, so a refused or unreadable message can't hide
 * inside it. Opened, it shows its messages as full shelf rows, newest first.
 *
 * It holds no open state of its own: it is open exactly while it, or one of its messages, is the
 * view's selection, so `j`/`k` and one-at-a-time come from the selection that already exists. The
 * view also renders the message rows, passed in as `children`, so it keeps owning every row.
 */

interface ShelfConversationProperties {
  conversation: Conversation;
  account: CommAccount | undefined;
  accountLabel: string;
  people: CommPersonWithHandles[];
  now: Date;
  /** It, or one of its messages, is the view's selection. */
  open: boolean;
  /** Clicking the header opens a closed conversation and closes an open one. */
  onToggle: () => void;
  /** Its messages' rows, newest first. */
  children: React.ReactNode;
}

export function ShelfConversation({
  conversation,
  account,
  accountLabel,
  people,
  now,
  open,
  onToggle,
  children,
}: ShelfConversationProperties) {
  const messagesId = React.useId();
  const { messages, newest } = conversation;
  const count = messages.length;
  const markers = React.useMemo(
    () => rollUpMarkers(messages, people, now),
    [messages, people, now],
  );

  return (
    <div className={rowShellClass(open, true)} data-testid="comms-conversation">
      <ClickableCard aria-expanded={open} aria-controls={messagesId} onClick={onToggle}>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={rowSenderClass}>{conversationWho(messages, people, account)}</span>
          <span className={rowMetaClass}>
            · {accountLabel} · {formatMessageTime(newest.received_at, now)} · {String(count)}{' '}
            messages
          </span>
        </div>
        <p className={open ? rowAskSelectedClass : rowAskClass}>
          {conversationLine(messages, people)}
        </p>
        <div className="mt-1.5">
          <RolledUpMarkers markers={markers} />
        </div>
      </ClickableCard>

      <AnimatedHeightCollapse open={open} testId="comms-conversation-messages">
        <div id={messagesId} className={conversationKidsClass}>
          {children}
        </div>
      </AnimatedHeightCollapse>
    </div>
  );
}
