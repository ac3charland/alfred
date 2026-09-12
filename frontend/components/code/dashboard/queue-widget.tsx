'use client';

import { ChevronRight, type LucideIcon } from 'lucide-react';
import * as React from 'react';

import { SurfaceCard } from '@/components/atoms/surface-card';
import { QueueWidgetRow } from '@/components/code/dashboard/queue-widget-row';
import { ViewLink } from '@/components/tasks/view-link';
import { projectColorFor } from '@/lib/code/project-color';
import { useProjects } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';

/** How many stories a pane shows before it is only a digest of a longer queue. */
export const QUEUE_WIDGET_ROWS = 5;

interface QueueWidgetProperties {
  /** The queue's name — the link text into its full page. */
  title: string;
  /** The queue's glyph, matching its sidebar link. */
  icon: LucideIcon;
  /** The full queue, ranked as its own page ranks it. Only the first few are drawn. */
  stories: readonly CodeStory[];
  /** Where the header links — the full page this pane digests. */
  href: string;
  /** Shown in place of the list when the queue is empty. */
  emptyMessage: string;
}

/**
 * One queue's digest pane on the Dashboard: a linked header carrying the queue's FULL size,
 * then its top {@link QUEUE_WIDGET_ROWS} stories, each opening its detail modal.
 *
 * The count is the whole queue rather than the rows drawn, so the pane says how much it is
 * hiding — "Backlog 23" with five rows reads honestly; "Backlog 5" would not.
 *
 * The entire header is the link, glyph and count and chevron included, so "click the title"
 * has a forgiving target rather than a five-word hit area.
 */
export function QueueWidget({
  title,
  icon: Icon,
  stories,
  href,
  emptyMessage,
}: QueueWidgetProperties) {
  // Creation order, not the live ranking: it is the slot that assigns each project its palette
  // colour (ALF-50), so a project's ref is tinted the same here as everywhere else.
  const projects = useProjects();
  const shown = stories.slice(0, QUEUE_WIDGET_ROWS);

  return (
    <SurfaceCard>
      <ViewLink href={href} className="group flex items-center gap-2">
        <Icon size={15} className="shrink-0 text-accent-teal" />
        <span className="text-sm font-medium text-foreground group-hover:underline">{title}</span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {stories.length}
        </span>
        <ChevronRight size={14} className="ml-auto shrink-0 text-muted-foreground" />
      </ViewLink>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {shown.map((story) => (
            <QueueWidgetRow
              key={story.ref}
              story={story}
              projectColor={projectColorFor(projects, story.project_id)}
            />
          ))}
        </ul>
      )}
    </SurfaceCard>
  );
}
