'use client';

import { MoreHorizontal } from 'lucide-react';
import * as React from 'react';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { IconButton } from '@/components/atoms/icon-button';
import { RatioBar, type RatioSegment } from '@/components/atoms/ratio-bar';
import { SurfaceCard } from '@/components/atoms/surface-card';
import { ViewLink } from '@/components/tasks/view-link';
import { projectBoardHref } from '@/lib/code/board-links';
import { projectColorFor, projectFillClasses } from '@/lib/code/project-color';
import { usePrRatio } from '@/lib/hooks/use-pr-ratio';
import { useCodeActions, useProjects } from '@/lib/stores/code-store';
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
 * The bar's entries, left to right: each project with at least one merged PR this window, then
 * Other, also dropped when empty. A project that shipped nothing this week reads the same as an
 * empty Other — nothing happened there — so its row is dropped for the same reason, rather than
 * crowding a legend that already grows with the project count.
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

  const entries: RatioEntry[] = ratio.repos
    .filter((repo) => repo.count > 0)
    .map((repo) => {
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
 * The card's ⋯ menu: every project in creation order, ticked when excluded from the ratio. A tick
 * saves at once and the menu stays open, so several can be flipped in one pass; `onSaved` runs
 * once the server holds the flag, since the ratio is computed from the database.
 */
function PrRatioExcludeMenu({ projects, onSaved }: { projects: Project[]; onSaved: () => void }) {
  const { updateProjectPrRatioExclusion } = useCodeActions();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="md" tone="neutral" aria-label="PR ratio options">
          <MoreHorizontal size={14} />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Exclude from PR ratio</DropdownMenuLabel>
        {projects.map((project) => (
          <DropdownMenuCheckboxItem
            key={project.id}
            checked={project.exclude_from_pr_ratio}
            onCheckedChange={() => {
              void updateProjectPrRatioExclusion(project.id, !project.exclude_from_pr_ratio).then(
                onSaved,
                () => {
                  // The store already rolled the tick back and toasted.
                },
              );
            }}
            onSelect={(event) => {
              event.preventDefault();
            }}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${projectFillClasses(projectColorFor(projects, project.id))}`}
            />
            {project.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The Dashboard's PR-ratio card: how the last seven days' merged pull requests split across
 * the Code module's projects, as a stacked bar plus a per-project legend. Each project wears
 * its module-wide colour, and its legend row opens its board; the bar itself is not interactive.
 * Its ⋯ menu excludes projects from the ratio: an excluded project simply isn't in the answer,
 * so nothing here filters — nor says anything was left out.
 *
 * It is an ornament, never a gate. An unconfigured deployment renders **nothing at all** (no
 * card, no gap), and a GitHub failure renders one muted line — either way the Dashboard around
 * it stays fully usable.
 *
 * Must be mounted under a `CodeProvider` (it reads `useProjects`).
 */
export function PrRatio() {
  const { state, refetch } = usePrRatio();
  // Creation order, not the live ranking: it is the slot `projectColorFor` assigns colours by —
  // and never filtered by exclusion first, so excluding one project shifts no other's colour.
  const projects = useProjects();

  if (state.status === 'unconfigured') return null;

  // In every state below, so the header never jumps — and in the error state too, since one repo
  // the token can't read fails the whole ratio, and excluding it drops that repo's own search (it
  // is still negated in the Other sweep).
  const menu = <PrRatioExcludeMenu projects={projects} onSaved={refetch} />;

  // Decided from the store alone, so it shows at once and wins over every fetch state: with no
  // project counted there is no split to draw, even when Other merged PRs. Two projects at least,
  // the ratio's own minimum — a lone project is an unconfigured ratio, which renders nothing.
  if (projects.length >= 2 && projects.every((project) => project.exclude_from_pr_ratio)) {
    return (
      <SurfaceCard title={TITLE} action={menu}>
        <p className="text-sm text-muted-foreground">All projects excluded from the PR ratio.</p>
      </SurfaceCard>
    );
  }

  // An answer that counted no project is stale once the store counts one again (an untick whose
  // save and refetch are still in flight): pulse until the new split lands rather than draw it.
  if (state.status === 'loading' || (state.status === 'ready' && state.ratio.repos.length === 0)) {
    return (
      <SurfaceCard title={TITLE} action={menu}>
        {/* Reserves the bar's height so the cards below don't jump when the counts land. */}
        <div className="h-2.5 w-full animate-pulse rounded-full bg-border motion-reduce:animate-none" />
      </SurfaceCard>
    );
  }

  if (state.status === 'error') {
    return (
      <SurfaceCard title={TITLE} action={menu}>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load PR counts.</p>
      </SurfaceCard>
    );
  }

  const { week, total } = state.ratio;
  const range = formatWindowRange(week.start, week.end);

  if (total === 0) {
    return (
      <SurfaceCard title={TITLE} detail={range} action={menu}>
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
    <SurfaceCard title={TITLE} detail={`${range}  ·  ${String(total)} total`} action={menu}>
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
