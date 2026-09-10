'use client';

import { Inbox } from 'lucide-react';
import * as React from 'react';

import { ViewHeading } from '@/components/atoms/view-heading';
import { accountHealth, classifierStalled } from '@/lib/comms';
import type { CommAccount, CommClassifierHealth, CommMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

import { AccountDot } from './account-dot';
import { ClassifierBanner } from './classifier-banner';
import { formatElapsed } from './comms-format';

/**
 * The module's masthead: what it is, and whether anything about it can be trusted right now.
 *
 * Three layers, in the order a reader needs them. The classifier banner sits ABOVE the dots
 * because it is not one of the source states and its fix is different. The dots are one per
 * ACCOUNT rather than one per ingestion home — a green dot over a dead mailbox is exactly the
 * failure the health surface exists to prevent, and two accounts sharing a poller can still
 * fail apart. Below them, a sentence per account that is not live, because a coloured dot says
 * that something is wrong and never what or what to do about it.
 */

interface CommsHeaderProperties {
  accounts: CommAccount[];
  messages: CommMessage[];
  health: CommClassifierHealth | undefined;
  now: Date;
}

/**
 * What one unhealthy account says, in the module's own voice. The tail differs by where the
 * account is polled from, because that is what decides whether the owner waits or acts: the
 * Mac's two go dark when it sleeps and come back on their own; a Worker-polled mailbox that has
 * stopped needs a person.
 */
export function accountSentence(account: CommAccount, now: Date): string | null {
  const state = accountHealth(account, now);
  if (state === 'live') return null;

  if (state === 'erroring') {
    const when =
      account.last_error_at === null ? 'recently' : formatElapsed(account.last_error_at, now);
    // The source's own words, sentence-terminated here rather than at the writer: an error
    // string arrives however the poller phrased it, and the line that follows needs a full stop.
    const reason = (account.last_error ?? 'the poll was refused').trim().replace(/[!.?]+$/, '');
    return `${account.label} stopped ingesting ${when} — ${reason}. This is not quiet, it is broken. Re-authorize.`;
  }

  const silence =
    account.last_seen_at === null
      ? 'has never synced'
      : `last synced ${formatElapsed(account.last_seen_at, now)}`;
  return account.home === 'daemon'
    ? `${account.label} ${silence} — the Mac is asleep. Anything sent there since won't appear until it wakes.`
    : `${account.label} ${silence} — the poll has stopped running. Anything sent there since won't appear until it starts again.`;
}

export function CommsHeader({ accounts, messages, health, now }: CommsHeaderProperties) {
  const stall = classifierStalled(health, messages, now);
  const sentences = accounts.flatMap((account) => {
    const sentence = accountSentence(account, now);
    return sentence === null ? [] : [{ account, sentence }];
  });

  return (
    <div className="flex flex-col gap-3">
      {stall.stalled && stall.since !== null && <ClassifierBanner since={stall.since} now={now} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewHeading
          icon={Inbox}
          title="Comms"
          description="Messages that ask something of you, in the order they need answering."
          accent="comms"
        />
        {accounts.length > 0 && (
          <div className="flex flex-wrap items-center gap-3" data-testid="account-dots">
            {accounts.map((account) => (
              <AccountDot key={account.id} account={account} now={now} />
            ))}
          </div>
        )}
      </div>

      {sentences.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="account-health-notes">
          {sentences.map(({ account, sentence }) => (
            <p
              key={account.id}
              className={cn(
                'text-[13px] leading-relaxed',
                accountHealth(account, now) === 'erroring'
                  ? 'text-accent-red'
                  : 'text-accent-amber',
              )}
            >
              {sentence}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
