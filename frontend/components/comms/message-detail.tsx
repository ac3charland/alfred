'use client';

import * as React from 'react';

import { isReclassifyPending } from '@/lib/comms';
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
 *
 * A re-run that ended in failure is said here and only here: the verdict still stands, so the
 * collapsed row is not wrong about anything and gets no chip — but the owner who asked has to be
 * able to find out, after a reload or from another tab, why nothing changed.
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

      {/* Tested as a string, not against null: for a beat after a deploy the row can lack the field
      altogether (the migration that adds it applies on merge, beside the deploy), and `undefined`
      is not a failure. */}
      {typeof message.reclassify_failed_at === 'string' && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-amber-400">Re-run failed</span>{' '}
          {formatMessageTime(message.reclassify_failed_at, now)}. The classifier couldn&apos;t
          produce a verdict, so this one stands.
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
        reclassifyPending={isReclassifyPending(message)}
      />
    </div>
  );
}
