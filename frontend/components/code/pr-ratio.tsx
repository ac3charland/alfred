'use client';

import * as React from 'react';

import { RatioBar, type RatioSegment } from '@/components/atoms/ratio-bar';
import { usePrRatio } from '@/lib/hooks/use-pr-ratio';
import type { PrRatioResponse } from '@/lib/types';

/**
 * Segment fills, cycled by config order, from the existing named-accent tokens. The bar
 * segment and its legend dot share one class so a repo reads the same in both places.
 */
const TONES = ['bg-accent-teal', 'bg-accent-blue', 'bg-accent-amber', 'bg-accent-green'];

function toneFor(index: number): string {
  return TONES[index % TONES.length] ?? 'bg-accent-teal';
}

const OTHER_LABEL = 'Other';

/**
 * Other gets a de-emphasized neutral rather than the next accent: the accents name the repos
 * the owner chose to measure, and the catch-all shouldn't compete with them for attention.
 */
const OTHER_TONE = 'bg-muted-foreground';

/** One legend row and its matching bar segment — a configured repo, or the Other bucket. */
interface RatioEntry {
  key: string;
  label: string;
  count: number;
  percentage: number;
  tone: string;
}

/**
 * The bar's entries, left to right: every configured repo (kept even at zero — the owner
 * asked for them), then Other, which is dropped when empty. A zero Other is indistinguishable
 * from an unmeasured one to a reader, so showing it would be noise either way.
 */
function toEntries(ratio: PrRatioResponse): RatioEntry[] {
  const entries: RatioEntry[] = ratio.repos.map((repo, index) => ({
    key: repo.repo,
    label: repo.label,
    count: repo.count,
    percentage: repo.percentage,
    tone: toneFor(index),
  }));

  if (ratio.other && ratio.other.count > 0) {
    entries.push({
      key: 'other',
      label: OTHER_LABEL,
      count: ratio.other.count,
      percentage: ratio.other.percentage,
      tone: OTHER_TONE,
    });
  }

  return entries;
}

/**
 * "Jul 20" for the calendar date `dayOffset` days from an offset-bearing ISO timestamp. Only
 * the date part is read, and it is formatted in UTC, so the label can't drift by a day
 * depending on where it happens to be rendered.
 */
function formatDay(iso: string, dayOffset: number): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * "Jul 20 – Jul 26" for a window whose `end` is the EXCLUSIVE next Monday — the label names
 * the last day the week actually covers.
 */
function formatWeekRange(start: string, end: string): string {
  return `${formatDay(start, 0)} – ${formatDay(end, -1)}`;
}

/** "RealPlay 33 percent, 3 pull requests; Alfred 67 percent, 6 pull requests". */
function describeSplit(entries: readonly RatioEntry[]): string {
  return entries
    .map(
      (entry) =>
        `${entry.label} ${String(entry.percentage)} percent, ${String(entry.count)} pull ${
          entry.count === 1 ? 'request' : 'requests'
        }`,
    )
    .join('; ');
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {children}
    </div>
  );
}

function Heading({ detail }: { detail?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="text-sm font-medium text-foreground">PRs merged this week</h3>
      {detail !== undefined && <p className="text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

/**
 * The Backlog's weekly PR-ratio card: how this week's merged pull requests split across the
 * configured repos, as a stacked bar plus a per-repo legend.
 *
 * It is an ornament, never a gate. An unconfigured deployment renders **nothing at all** (no
 * card, no gap), and a GitHub failure renders one muted line — either way the Backlog beneath
 * it stays fully usable.
 */
export function PrRatio() {
  const state = usePrRatio();

  if (state.status === 'unconfigured') return null;

  if (state.status === 'loading') {
    return (
      <Card>
        <Heading />
        {/* Reserves the bar's height so the story list doesn't jump when the counts land. */}
        <div className="h-2.5 w-full animate-pulse rounded-full bg-border motion-reduce:animate-none" />
      </Card>
    );
  }

  if (state.status === 'error') {
    return (
      <Card>
        <Heading />
        <p className="text-sm text-muted-foreground">Couldn&apos;t load PR counts.</p>
      </Card>
    );
  }

  const { week, total } = state.ratio;
  const range = formatWeekRange(week.start, week.end);

  if (total === 0) {
    return (
      <Card>
        <Heading detail={range} />
        {/* A week genuinely starts at zero every Monday — a normal state, not an error. */}
        <p className="text-sm text-muted-foreground">No PRs merged yet this week.</p>
      </Card>
    );
  }

  const entries = toEntries(state.ratio);
  const segments: RatioSegment[] = entries.map((entry) => ({
    label: entry.label,
    value: entry.count,
    tone: entry.tone,
  }));

  return (
    <Card>
      <Heading detail={`${range}  ·  ${String(total)} total`} />
      <RatioBar segments={segments} ariaLabel={describeSplit(entries)} />
      <ul className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        {entries.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${entry.tone}`} />
            <span className="text-foreground">{entry.label}</span>
            <span className="font-medium text-foreground">{entry.percentage}%</span>
            <span className="text-muted-foreground">({entry.count})</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
