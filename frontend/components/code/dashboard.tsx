'use client';

import { GitBranch, ListOrdered, UserCheck } from 'lucide-react';
import * as React from 'react';

import { ViewHeading } from '@/components/atoms/view-heading';
import { QueueWidget } from '@/components/code/dashboard/queue-widget';
import { LocVelocity } from '@/components/code/loc-velocity';
import { PrRatio } from '@/components/code/pr-ratio';
import {
  DEFAULT_BACKLOG_STATUSES,
  HUMAN_REVIEW_STATUSES,
  useBacklog,
} from '@/lib/stores/code-store';

/**
 * The Code module's landing view (`/code` and `/code/dashboard`) — "how is the factory doing?"
 * in one screen, and the module's answer to "what now?" without hiding half of it.
 *
 * It carries the module's hero name: the two queues below name themselves plainly and say what
 * they hold, so the landing page is where "The Software Factory" belongs.
 *
 * Four panels, top to bottom:
 *
 * - **`LocVelocity`** — lines changed per week with a trailing-average trend, the module's only
 *   measure of output VOLUME.
 * - **`PrRatio`** — the last seven days' merged-PR split, moved here from the Backlog, where it
 *   competed with a re-ranking workspace for attention and was seen only when the owner went to
 *   re-rank. Both are ornaments: an unconfigured deployment renders neither, with no gap.
 * - **Two digest panes** — the top stories of Needs human action and the Backlog, each header
 *   linking to its full page and each row opening that story's detail modal. They read the same
 *   store slices their pages read, so nothing is fetched twice. The two overlap by design: the
 *   Backlog's states are a superset, so a top-ranked story awaiting review belongs in both.
 *
 * Nothing here is persisted or mutated — the two GitHub series are derived and live, so they
 * stay out of `CodeProvider` entirely (see `useLocVelocity` / `usePrRatio`).
 *
 * Must be mounted under a `CodeProvider` (the panes read `useBacklog`).
 */
export function Dashboard() {
  // Both status sets are module constants, so they're referentially stable and `useBacklog`'s
  // memo only recomputes when the story slice itself changes. No project filter on either pane:
  // the Dashboard is cross-project by definition.
  const humanAction = useBacklog({ statuses: HUMAN_REVIEW_STATUSES });
  const backlog = useBacklog({ statuses: DEFAULT_BACKLOG_STATUSES });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <ViewHeading
        icon={GitBranch}
        title="The Software Factory"
        description="Your code module at a glance — what you're shipping, and what's waiting on you."
      />

      <LocVelocity />
      <PrRatio />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <QueueWidget
          title="Needs human action"
          icon={UserCheck}
          stories={humanAction}
          href="/code/needs-human-action"
          emptyMessage="Nothing needs your attention right now."
        />
        <QueueWidget
          title="Backlog"
          icon={ListOrdered}
          stories={backlog}
          href="/code/backlog"
          emptyMessage="No stories yet. Send a story to the Code module from your inbox to start ranking your backlog."
        />
      </div>
    </div>
  );
}
