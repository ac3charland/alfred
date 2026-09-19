'use client';

import { CircleAlert, Gauge, Mail } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import { formatElapsed } from '@/components/comms/comms-format';
import { GMAIL_LABEL } from '@/components/reader/reader-header';
import type { ReaderBanner as ReaderBannerState } from '@/lib/reader/health';
import { cn } from '@/lib/utils';

/**
 * The module's one banner: the single thing wrong with the Reader right now, said in full.
 *
 * Only ever one renders — which one is decided by `readerBanner`, not here — because three
 * stacked banners would push the list off a phone screen and the states are not equally
 * actionable. Each says what still works as well as what doesn't: the owner's next move after
 * reading it is different in all three cases, and "something is broken" alone would only teach
 * them to skim past it.
 *
 * Red is reserved for the REFUSED mailbox, the one state that needs a person (re-authorize).
 * Everything else is amber: a mailbox merely gone quiet, a stalled summariser and a spent
 * ceiling all leave what has already arrived intact, and spending the alarm on them would spend
 * it on the one that matters.
 */

/** The two tones, written out in full — Tailwind scans source text, not runtime strings. */
const TONE = {
  red: {
    shell: 'border border-accent-red/50 bg-accent-red/[0.06] glow-red',
    icon: 'text-accent-red',
  },
  amber: {
    shell: 'border border-accent-amber/50 bg-accent-amber/[0.06] glow-amber',
    icon: 'text-accent-amber',
  },
} as const;

interface BannerContent {
  tone: keyof typeof TONE;
  icon: LucideIcon;
  /** The claim, emphasised — what a reader takes from one glance. */
  lead: string;
  /** What still works, and what to do about what doesn't. */
  rest: string;
}

/** An error string as its writer phrased it, sentence-terminated by the line that quotes it. */
function reason(error: string | null, fallback: string): string {
  const written = error?.trim().replace(/[!.?]+$/, '');
  return written === undefined || written === '' ? fallback : written;
}

/** How many claimed posts the spent budget is holding, in the words that fit the count. */
function ceilingTail(count: number): string {
  if (count === 0) {
    return (
      '— nothing is waiting on it. Anything arriving now is stored with its title and link, ' +
      'and is summarised after the UTC day rolls over.'
    );
  }
  const posts = count === 1 ? '1 claimed post waits' : `${String(count)} claimed posts wait`;
  // "Already stored" rather than "in the list": a claimed post the owner has archived is still
  // waiting on tomorrow's budget and is still counted here, and it is no longer in any list.
  return (
    `— ${posts} for tomorrow. Their titles and links are already stored; their summaries land ` +
    'after the UTC day rolls over.'
  );
}

/** What each banner says, in one place: the component below only lays it out. */
function readerBannerContent(banner: ReaderBannerState, now: Date): BannerContent {
  switch (banner.kind) {
    case 'gmail': {
      const { account } = banner;
      if (banner.state === 'erroring') {
        const when =
          account.last_error_at === null ? 'recently' : formatElapsed(account.last_error_at, now);
        return {
          tone: 'red',
          icon: Mail,
          lead: 'Gmail is not delivering.',
          rest:
            `The personal mailbox stopped polling ${when} (${reason(account.last_error, 'the poll was refused')}). ` +
            'Posts already here are still summarised; nothing new arrives until it is ' +
            're-authorized — see the Comms header.',
        };
      }
      // Amber, and measured rather than alarmed: a poll that has gone quiet has refused nothing
      // and lost nothing, and reads exactly like a machine that was asleep.
      const silence =
        account.last_seen_at === null
          ? 'has never synced'
          : `last synced ${formatElapsed(account.last_seen_at, now)}`;
      return {
        tone: 'amber',
        icon: Mail,
        lead: `${GMAIL_LABEL} ${silence}`,
        rest:
          '— the poll has stopped running. Posts already here are still summarised; nothing new ' +
          'arrives until it starts again — see the Comms header.',
      };
    }
    case 'stalled': {
      return {
        tone: 'amber',
        icon: CircleAlert,
        lead: `Summariser stalled ${formatElapsed(banner.since, now)}`,
        rest:
          `— ${reason(banner.error, 'no summary has landed since')}. Everything still arriving ` +
          'is still stored with its title and link; nothing new is being summarised.',
      };
    }
    case 'ceiling': {
      return {
        tone: 'amber',
        icon: Gauge,
        lead: `Daily summary ceiling reached (${String(banner.cap)})`,
        rest: ceilingTail(banner.waiting),
      };
    }
  }
}

export interface ReaderBannerProperties {
  banner: ReaderBannerState;
  now: Date;
}

export function ReaderBanner({ banner, now }: ReaderBannerProperties) {
  const { tone, icon: Icon, lead, rest } = readerBannerContent(banner, now);

  return (
    <div
      role="status"
      // Never announced, this one included: the elapsed readings inside re-word themselves every
      // minute, and a live region would read the whole banner out again at each of them. The
      // header's own sentence carries the same state to a reader who goes looking for it, which
      // is a better deal than the banner interrupting on the minute for the length of an outage.
      aria-live="off"
      className={cn('flex items-start gap-2.5 rounded-xl px-3 py-2.5', TONE[tone].shell)}
    >
      <Icon size={15} className={cn('mt-0.5 shrink-0', TONE[tone].icon)} />
      <p className="text-[13px] leading-relaxed text-foreground">
        <span className="font-medium">{lead}</span> {rest}
      </p>
    </div>
  );
}
