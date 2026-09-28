'use client';

import * as React from 'react';

import { RatioBar, type RatioSegment } from '@/components/atoms/ratio-bar';
import { SurfaceCard } from '@/components/atoms/surface-card';
import { ViewLink } from '@/components/tasks/view-link';
import { projectBoardHref } from '@/lib/code/board-links';
import { projectColorFor, projectFillClasses } from '@/lib/code/project-color';
import { usePrRatio } from '@/lib/hooks/use-pr-ratio';
import { useProjects } from '@/lib/stores/code-store';
import type { PrRatioResponse, Project } from '@/lib/types';

const OTHER_LABEL = 'Other';

/**
 * Other gets a de-emphasized neutral rather than a project colour: the accents name the
 * projects, and the catch-all shouldn't compete with them for attention.
 */
const OTHER_TONE = 'bg-muted-foreground';

/** One legend row and its matching bar segment — a project's repo, or the Other bucket. */
interface RatioEntry {
  key: string;
  label: string;
  count: number;
  percentage: number;
  tone: string;
  /** The project's board. Absent for Other, and for a repo the store has no project for. */
  href?: string;
}

/**
 * The bar's entries, left to right: every project (kept even at zero — each is a repo the owner
 * ships to), then Other, which is dropped when empty. A zero Other is indistinguishable from an
 * unmeasured one to a reader, so showing it would be noise either way.
 *
 * Each entry is joined to its project by `owner/name` — unique per project, and the very columns
 * the server built `repo` from — so it wears the colour `projectColorFor` gives that project
 * everywhere else in the module, and links to its board. A repo with no project in the store (one
 * created on another device since this page loaded) gets `projectColorFor`'s fallback colour and
 * no link until the next full load re-seeds the store.
 */
function toEntries(ratio: PrRatioResponse, projects: Project[]): RatioEntry[] {
  const byRepo = new Map(
    projects.map((project) => [`${project.repo_owner}/${project.repo_name}`, project]),
  );

  const entries: RatioEntry[] = ratio.repos.map((repo) => {
    const project = byRepo.get(repo.repo);
    return {
      key: repo.repo,
      // Already the project's name — the server labels each repo with it.
      label: repo.label,
      count: repo.count,
      percentage: repo.percentage,
      tone: projectFillClasses(projectColorFor(projects, project?.id ?? null)),
      ...(project && { href: projectBoardHref(project.id) }),
    };
  });

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
 * "Jul 17 – Jul 24" — the first and last day the rolling window covers. Both ends are
 * inclusive instants, so neither is nudged: the end day is simply today.
 */
function formatWindowRange(start: string, end: string): string {
  return `${formatDay(start, 0)} – ${formatDay(end, 0)}`;
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

/** One legend row's contents: the swatch, the name, the share and the raw count. */
function LegendContent({ entry, linked }: { entry: RatioEntry; linked: boolean }) {
  return (
    <>
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${entry.tone}`} />
      <span className={linked ? 'text-foreground group-hover:underline' : 'text-foreground'}>
        {entry.label}
      </span>
      <span className="font-medium text-foreground">{entry.percentage}%</span>
      <span className="text-muted-foreground">({entry.count})</span>
    </>
  );
}

const TITLE = 'PRs merged in the last 7 days';

/**
 * The Dashboard's PR-ratio card: how the last seven days' merged pull requests split across
 * the Code module's projects, as a stacked bar plus a per-project legend. Each project wears
 * its module-wide colour, and its legend row opens its board; the bar itself is not interactive.
 *
 * It is an ornament, never a gate. An unconfigured deployment renders **nothing at all** (no
 * card, no gap), and a GitHub failure renders one muted line — either way the Dashboard around
 * it stays fully usable.
 *
 * Must be mounted under a `CodeProvider` (it reads `useProjects`).
 */
export function PrRatio() {
  const state = usePrRatio();
  // Creation order, not the live ranking: it is the slot `projectColorFor` assigns colours by.
  const projects = useProjects();

  if (state.status === 'unconfigured') return null;

  if (state.status === 'loading') {
    return (
      <SurfaceCard title={TITLE}>
        {/* Reserves the bar's height so the cards below don't jump when the counts land. */}
        <div className="h-2.5 w-full animate-pulse rounded-full bg-border motion-reduce:animate-none" />
      </SurfaceCard>
    );
  }

  if (state.status === 'error') {
    return (
      <SurfaceCard title={TITLE}>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load PR counts.</p>
      </SurfaceCard>
    );
  }

  const { week, total } = state.ratio;
  const range = formatWindowRange(week.start, week.end);

  if (total === 0) {
    return (
      <SurfaceCard title={TITLE} detail={range}>
        {/* A genuinely quiet week — a normal state, not an error. */}
        <p className="text-sm text-muted-foreground">No PRs merged in the last 7 days.</p>
      </SurfaceCard>
    );
  }

  const entries = toEntries(state.ratio, projects);
  // `entry.key` (unique per entry), not `entry.label` (the display name, which projects.name
  // has no unique constraint on — two projects can share a name, or collide with "Other").
  const segments: RatioSegment[] = entries.map((entry) => ({
    label: entry.key,
    value: entry.count,
    tone: entry.tone,
  }));

  return (
    <SurfaceCard title={TITLE} detail={`${range}  ·  ${String(total)} total`}>
      <RatioBar segments={segments} ariaLabel={describeSplit(entries)} />
      <ul className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        {entries.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2 text-sm">
            {entry.href === undefined ? (
              <LegendContent entry={entry} linked={false} />
            ) : (
              // A real `<a href>`: a plain click opens the board client-side, a modified click
              // opens a new tab — the same as the digest panes below.
              <ViewLink
                href={entry.href}
                className="group flex items-center gap-2 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              >
                <LegendContent entry={entry} linked />
              </ViewLink>
            )}
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}
