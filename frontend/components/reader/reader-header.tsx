'use client';

import { BookOpen } from 'lucide-react';
import * as React from 'react';

import { StatusDot, type StatusDotState } from '@/components/atoms/status-dot';
import { ViewHeading } from '@/components/atoms/view-heading';
import { formatElapsed } from '@/components/comms/comms-format';
import { accountHealth } from '@/lib/comms';
import { type SummariserState, summariserStalled } from '@/lib/reader/health';
import type {
  CommAccount,
  ReaderHealth,
  ReaderHealthSnapshot,
  ReaderPostListItem,
} from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The reading list's masthead: what the view holds, and whether anything behind it can be
 * trusted right now.
 *
 * Two dots, because the Reader has two ways of going quiet and they need different fixes: the
 * mailbox can stop delivering (nothing new arrives at all) and the summariser can stop working
 * (posts arrive and sit unsummarised). An empty list looks identical under either, which is
 * exactly why the module needs this line at all.
 *
 * Beneath the dots, a sentence per state that is not live — a coloured dot says that something
 * is wrong and never what or what to do about it. The module's own banner, which says more and
 * says it louder, sits above this block and is the view's to render.
 */

/**
 * The Reader's name for the mailbox, which the account calls something shorter of its own. Shared
 * with the banner, so the two surfaces cannot end up calling the same mailbox different things.
 */
export const GMAIL_LABEL = 'Gmail (personal)';

/** The summariser's state in the words the header uses, so the dot and the sentence agree. */
const SUMMARISER_WORD: Record<SummariserState, string> = {
  live: 'live',
  stalled: 'stalled',
  never: 'never ran',
};

/**
 * Amber for both ways of not working. The dot's tone only has to separate "fine" from "not
 * fine" — which of the two it is, and what to do about it, is the label's and the sentence's
 * job, and they say it in words rather than in a hue.
 */
const SUMMARISER_TONE: Record<SummariserState, StatusDotState> = {
  live: 'live',
  stalled: 'stale',
  never: 'stale',
};

/** An error string as its writer phrased it, sentence-terminated by the line that quotes it. */
function reason(error: string | null, fallback: string): string {
  const written = error?.trim().replace(/[!.?]+$/, '');
  return written === undefined || written === '' ? fallback : written;
}

/** Why the mailbox is in the state it is — the dot's hover/focus title, in the Comms treatment. */
function gmailReason(account: CommAccount, now: Date): string {
  if (accountHealth(account, now) === 'erroring') {
    const when =
      account.last_error_at === null ? '' : ` (${formatElapsed(account.last_error_at, now)})`;
    return `${GMAIL_LABEL} — ${account.last_error ?? 'The last poll failed'}${when}`;
  }
  if (account.last_seen_at === null) return `${GMAIL_LABEL} — Never polled successfully`;
  return `${GMAIL_LABEL} — Last synced ${formatElapsed(account.last_seen_at, now)}`;
}

/** What one unhealthy mailbox says, in the Reader's voice: what stops, and what it takes to start. */
function gmailSentence(account: CommAccount, now: Date): string | null {
  const state = accountHealth(account, now);
  if (state === 'live') return null;

  if (state === 'erroring') {
    const when =
      account.last_error_at === null ? 'recently' : formatElapsed(account.last_error_at, now);
    return (
      `${GMAIL_LABEL} stopped ingesting ${when} — ${reason(account.last_error, 'the poll was refused')}. ` +
      'Nothing new reaches the Reader until it is re-authorized.'
    );
  }

  const silence =
    account.last_seen_at === null
      ? 'has never synced'
      : `last synced ${formatElapsed(account.last_seen_at, now)}`;
  return (
    `${GMAIL_LABEL} ${silence} — the poll has stopped running. Nothing new reaches the Reader ` +
    'until it starts again.'
  );
}

/**
 * Why the summariser is in the state it is — the dot's hover/focus title. A stall quotes what
 * the tick recorded and how long ago; a working summariser quotes its last clean pass.
 */
function summariserReason(
  health: ReaderHealth | undefined,
  stall: { state: SummariserState; since: string | null },
  now: Date,
): string {
  if (stall.state === 'never') return 'The summariser has never run — the tick has never fired';
  if (stall.state === 'stalled') {
    const when = stall.since === null ? '' : ` (${formatElapsed(stall.since, now)})`;
    return `${reason(health?.last_error ?? null, 'No summary has landed')}${when}`;
  }
  const success = health?.last_success_at ?? null;
  return success === null
    ? 'Running — no clean pass recorded yet'
    : `Last clean run ${formatElapsed(success, now)}`;
}

/** What a summariser that is not live says: when it stopped, why, and what still happens. */
function summariserSentence(
  health: ReaderHealth | undefined,
  stall: { state: SummariserState; since: string | null },
  now: Date,
): string | null {
  if (stall.state === 'live') return null;
  if (stall.state === 'never') return "The summariser has never run — check the Worker's cron.";

  const when = stall.since === null ? 'recently' : formatElapsed(stall.since, now);
  return (
    `Summariser stalled ${when} — ${reason(health?.last_error ?? null, 'no summary has landed since')}. ` +
    'Posts are still arriving; none are being summarised.'
  );
}

export interface ReaderHeaderProperties {
  snapshot: ReaderHealthSnapshot;
  /** The posts the stall rules read — a claimed post waiting is one of the two signals. */
  posts: ReaderPostListItem[];
  now: Date;
  /** The view's own count line, phrased by the view that owns the list. */
  description: string;
}

export function ReaderHeader({ snapshot, posts, now, description }: ReaderHeaderProperties) {
  const { account, health } = snapshot;
  const stall = summariserStalled(health, posts, now);
  const gmail = account === undefined ? undefined : accountHealth(account, now);

  const notes: { key: string; tone: 'amber' | 'red'; text: string }[] = [];
  const summariser = summariserSentence(health, stall, now);
  if (summariser !== null) notes.push({ key: 'summariser', tone: 'amber', text: summariser });
  if (account !== undefined) {
    const sentence = gmailSentence(account, now);
    if (sentence !== null) {
      notes.push({
        key: 'gmail',
        tone: gmail === 'erroring' ? 'red' : 'amber',
        text: sentence,
      });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewHeading icon={BookOpen} title="Reader" description={description} accent="reader" />

        <div className="flex flex-wrap items-center gap-3" data-testid="reader-health-dots">
          <StatusDot
            state={SUMMARISER_TONE[stall.state]}
            label="summariser"
            // The summariser's own three words, not the dot's three tones: amber covers both
            // "stalled" and "never ran" here, so the tone word alone would not say which.
            stateLabel={SUMMARISER_WORD[stall.state]}
            title={summariserReason(health, stall, now)}
          />
          {/* No account row means the mailbox was never provisioned — there is no dot to draw. */}
          {account !== undefined && gmail !== undefined && (
            <StatusDot
              state={gmail}
              label={GMAIL_LABEL}
              title={gmailReason(account, now)}
              elapsed={
                gmail !== 'live' && account.last_seen_at !== null
                  ? formatElapsed(account.last_seen_at, now)
                  : undefined
              }
            />
          )}
        </div>
      </div>

      {notes.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="reader-health-notes">
          {notes.map((note) => (
            <p
              key={note.key}
              className={cn(
                'text-[13px] leading-relaxed',
                note.tone === 'red' ? 'text-accent-red' : 'text-accent-amber',
              )}
            >
              {note.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
