'use client';

import { Inbox } from 'lucide-react';
import * as React from 'react';

import { ViewHeading } from '@/components/atoms/view-heading';
import {
  COMMS_LIVE_WINDOW_MS,
  accountHealth,
  classifierStalled,
  heldNow,
  lastPing,
} from '@/lib/comms';
import type { CommAccount, CommClassifierHealth, CommMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

import { AccountDot } from './account-dot';
import { ClassifierBanner } from './classifier-banner';
import { formatElapsed } from './comms-format';

/**
 * The module's masthead: what it is, and whether anything about it can be trusted right now.
 *
 * Above everything, whether the page itself is live: a view that may have missed something says
 * so rather than passing off what it last read as the present. Then three layers, in the order a
 * reader needs them. The classifier banner sits ABOVE the dots because it is not one of the
 * source states and its fix is different. The dots are one per ACCOUNT rather than one per
 * ingestion home — a green dot over a dead mailbox is exactly the failure the health surface
 * exists to prevent, and two accounts sharing a poller can still fail apart. Directly beneath the
 * dots, which source pinged last and how long ago — the one number that shows the surface is
 * still moving. Below them, a sentence per account that is not live, because a coloured dot says
 * that something is wrong and never what or what to do about it.
 */

interface CommsHeaderProperties {
  accounts: CommAccount[];
  messages: CommMessage[];
  health: CommClassifierHealth | undefined;
  now: Date;
  /** The newest verdict the server knows of — see `classifierStalled`. */
  lastClassifiedAt?: string | null | undefined;
  /**
   * The last moment the view was current, and only while it is NOT live — `undefined` means live.
   * A view that may be behind has to say so, or it is quietly lying about what needs answering.
   */
  notLiveSince?: string | undefined;
  /** `false` while no read of the view has ever landed — there is nothing yet to show or date. */
  loaded?: boolean | undefined;
  /**
   * When the most recent reconcile attempt began, successful or not — `null` between attempts.
   * Held against the account dots for a short grace window (`heldNow`) so a returning tab's
   * reconnect doesn't flash an account offline for the moment the read itself takes — ALF-252.
   */
  reconcileStartedAt?: string | null | undefined;
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

export function CommsHeader({
  accounts,
  messages,
  health,
  now,
  lastClassifiedAt = null,
  notLiveSince,
  loaded = true,
  reconcileStartedAt = null,
}: CommsHeaderProperties) {
  const heading = (
    <ViewHeading
      icon={Inbox}
      title="Comms"
      description="Messages that ask something of you, in the order they need answering."
      accent="comms"
    />
  );

  // A page that never loaded has nothing to show beyond that — no dot, ping, account sentence
  // or classifier banner, because every one of them would be partial data presented as fact.
  if (!loaded) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <p role="alert" className="text-[13px] leading-relaxed text-accent-amber">
          Couldn&apos;t load Comms — retrying.
        </p>
      </div>
    );
  }

  // The flip to not-live happens on its own 1s re-check (`useCommsLive`), which can land
  // between two ticks of `now` — the view's own clock, coalesced to a 30s bucket for display.
  // Reading the "ago" straight off `now` can then undercount: caught right after the flip, fewer
  // than 60s of it may show on the bucketed clock even though the live window itself is over a
  // minute, so it reads "just now" for data that just went stale. Floor the clock fed to
  // `formatElapsed` at the flip instant itself (`notLiveSince + COMMS_LIVE_WINDOW_MS`) so the
  // text never reads newer than the flip that produced it — `now` still wins once it catches up,
  // which is what keeps a pinned `now` driving this in stories and tests.
  const notLiveClock =
    notLiveSince === undefined
      ? now
      : new Date(Math.max(now.getTime(), Date.parse(notLiveSince) + COMMS_LIVE_WINDOW_MS + 1));

  const stall = classifierStalled(health, messages, now, lastClassifiedAt);
  const ping = lastPing(accounts);
  // The account dots' own clock: held at a reconcile's own start for a short grace window so a
  // returning tab's reconnect never flashes a live account offline — see `heldNow` / ALF-252.
  const accountsNow = heldNow(now, reconcileStartedAt);
  const sentences = accounts.flatMap((account) => {
    const sentence = accountSentence(account, accountsNow);
    return sentence === null ? [] : [{ account, sentence }];
  });

  return (
    <div className="flex flex-col gap-3">
      {notLiveSince !== undefined && (
        <p role="alert" className="text-[13px] leading-relaxed text-accent-amber">
          Not live — this is what was here {formatElapsed(notLiveSince, notLiveClock)}. Anything
          since may be missing until it refreshes.
        </p>
      )}
      {stall.stalled && stall.since !== null && <ClassifierBanner since={stall.since} now={now} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {heading}
        {accounts.length > 0 && (
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap items-center gap-3" data-testid="account-dots">
              {accounts.map((account) => (
                <AccountDot key={account.id} account={account} now={accountsNow} />
              ))}
            </div>
            {ping !== null && (
              <p className="text-[11px] text-muted-foreground/70" data-testid="last-ping">
                Last ping {formatElapsed(ping.at, now)} · {ping.account.label}
              </p>
            )}
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
