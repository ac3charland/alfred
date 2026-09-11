'use client';

import * as React from 'react';

import { accountHealth } from '@/lib/comms';
import type { CommAccount } from '@/lib/types';
import { cn } from '@/lib/utils';

import { formatElapsed } from './comms-format';

/**
 * One account's indicator — the smallest surface in the module and the one carrying its most
 * important claim.
 *
 * A firewall's whole value is that its zero means something, and a zero that can quietly mean
 * "we stopped looking" is worth less than no zero at all. So no source is assumed to be
 * working, and the two ways of not working are drawn apart: STALE is nothing arriving (the Mac
 * is asleep, a cron didn't fire) and ERRORING is polls running and being refused (a revoked
 * token, an auth failure). They look the same from message volume alone; only a successful
 * poll separates them.
 */

const DOT_TONE = {
  live: 'bg-accent-green',
  stale: 'bg-accent-amber',
  erroring: 'bg-accent-red',
} as const;

/** Each state in the words the header uses for it, so the label and the sentence agree. */
const STATE_WORD = {
  live: 'live',
  stale: 'stale',
  erroring: 'erroring',
} as const;

interface AccountDotProperties {
  account: CommAccount;
  now: Date;
}

/**
 * Why this account is in the state it is — the dot's hover/focus title. An error is quoted as
 * the source gave it; a silence is quoted as how long it has been silent.
 */
export function accountReason(account: CommAccount, now: Date): string {
  const state = accountHealth(account, now);
  if (state === 'erroring') {
    const when =
      account.last_error_at === null ? '' : ` (${formatElapsed(account.last_error_at, now)})`;
    return `${account.last_error ?? 'The last poll failed'}${when}`;
  }
  if (account.last_seen_at === null) return 'Never polled successfully';
  return `Last synced ${formatElapsed(account.last_seen_at, now)}`;
}

export function AccountDot({ account, now }: AccountDotProperties) {
  const state = accountHealth(account, now);
  const reason = accountReason(account, now);

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      title={`${account.label} — ${reason}`}
    >
      <span
        // The state is on the LABEL, not left to colour alone: a red dot and an amber dot are
        // the same dot to a screen reader, and to plenty of eyes.
        aria-label={`${account.label} · ${STATE_WORD[state]}`}
        role="img"
        className={cn('h-2 w-2 shrink-0 rounded-full', DOT_TONE[state])}
      />
      <span>{account.label}</span>
      {state !== 'live' && account.last_seen_at !== null && (
        <span className="text-muted-foreground/70">
          · {formatElapsed(account.last_seen_at, now)}
        </span>
      )}
    </span>
  );
}
