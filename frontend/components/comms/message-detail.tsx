'use client';

import * as React from 'react';

import type { DeepLink } from '@/lib/comms/deep-link';
import type { CommMessage, CommTier, CommVerdict } from '@/lib/types';

import { formatMessageTime } from './comms-format';
import { detailBodyClass, detailClass } from './message-row.styles';
import { type RowVerbHandlers, RowVerbs } from './row-verbs';

/**
 * What an expanded row shows: the message as it arrived, why the classifier put it where it
 * did, and the verbs.
 *
 * The reason is here rather than on the collapsed row because it answers a question the owner
 * only asks when they disagree — and when they do, it is the difference between correcting the
 * rubric and correcting one row. A verdict with no reason is a verdict that can't be audited,
 * which defeats the point of writing a rubric at all.
 */

interface MessageDetailProperties {
  message: CommMessage;
  accountLabel: string;
  verdict: CommVerdict | undefined;
  now: Date;
  link: DeepLink;
  linkRef: React.Ref<HTMLAnchorElement>;
  currentTier: CommTier | null;
  handlers: RowVerbHandlers;
  tierMenuOpen: boolean;
  onTierMenuOpenChange: (open: boolean) => void;
  shelved?: boolean;
}

export function MessageDetail({
  message,
  accountLabel,
  verdict,
  now,
  link,
  linkRef,
  currentTier,
  handlers,
  tierMenuOpen,
  onTierMenuOpenChange,
  shelved = false,
}: MessageDetailProperties) {
  const body = message.body.trim();

  return (
    <div className={detailClass}>
      {message.subject !== null && message.subject !== '' && (
        <p className="text-sm font-medium text-foreground">{message.subject}</p>
      )}

      <p className="text-xs text-muted-foreground">
        {message.sender_handle} · {accountLabel} · {formatMessageTime(message.received_at, now)}
      </p>

      {body === '' ? (
        <p className="text-[12.5px] italic text-muted-foreground/70">
          No readable text arrived with this message.
        </p>
      ) : (
        <div className={detailBodyClass}>{body}</div>
      )}

      {verdict !== undefined && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Why:</span> {verdict.reason}
        </p>
      )}

      <RowVerbs
        link={link}
        linkRef={linkRef}
        currentTier={currentTier}
        handlers={handlers}
        tierMenuOpen={tierMenuOpen}
        onTierMenuOpenChange={onTierMenuOpenChange}
        shelved={shelved}
      />
    </div>
  );
}
