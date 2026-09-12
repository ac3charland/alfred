'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Backlog } from '@/components/code/backlog';
import { Board } from '@/components/code/board';
import { Dashboard } from '@/components/code/dashboard';
import { NeedsHumanAction } from '@/components/code/needs-human-action';
import { useCodeActions } from '@/lib/stores/code-store';

const CODE_PREFIX = '/code/';
const DASHBOARD_SEGMENT = 'dashboard';
const BACKLOG_SEGMENT = 'backlog';
const NEEDS_HUMAN_ACTION_SEGMENT = 'needs-human-action';

/**
 * Client-side view router for the Code module — the board's counterpart to `TaskViews`.
 *
 * Every code page renders this one component, which derives the active view purely from the
 * URL: a `/code/<projectId>` path shows that project's Board; `/code/backlog` and
 * `/code/needs-human-action` show the two cross-project queues; and the bare `/code`, like the
 * explicit `/code/dashboard`, shows the module's DEFAULT view — the Dashboard.
 *
 * Entering the module still surfaces the work blocked on the owner, which is why the default
 * moved here from the Needs-human-action queue (ALF-174): the Dashboard leads with that queue's
 * digest pane, one click from each story's modal, and adds the two things a queue could never
 * show — output volume and the merged-PR split.
 *
 * Because it's the SAME mounted component on every code route and reads from the layout-seeded
 * CodeProvider, selecting a project or another queue via `ViewLink` (a History push, no RSC
 * round-trip) just re-derives the view. A hard load of any path renders the match server-side.
 *
 * The seed-once store means statuses can drift after a long-lived session (a realtime UPDATE
 * dropped by a stale connection, a move that landed while the tab was backgrounded). So on every
 * navigation within the module — keyed on `pathname`, which also covers entry to it, and so the
 * Dashboard's digest panes too — refetch and reconcile the ticket statuses (ALF-69). `refreshStatuses` is stable and
 * swallows its own errors, so this is a fire-and-forget reconcile that never blocks the view.
 */
export function CodeView() {
  const pathname = usePathname();
  const { refreshStatuses } = useCodeActions();

  React.useEffect(() => {
    void refreshStatuses();
  }, [pathname, refreshStatuses]);

  if (pathname.startsWith(CODE_PREFIX)) {
    const segment = pathname.slice(CODE_PREFIX.length);
    // Each literal segment is its own view, not a project id — none is a UUID, so <Board> would
    // render "This project could not be found" for every one of them.
    if (segment === DASHBOARD_SEGMENT) return <Dashboard />;
    if (segment === BACKLOG_SEGMENT) return <Backlog />;
    if (segment === NEEDS_HUMAN_ACTION_SEGMENT) return <NeedsHumanAction />;
    // An empty tail (a trailing slash) falls through to the default view below.
    if (segment.length > 0) return <Board projectId={segment} />;
  }

  // Bare `/code` (and a trailing slash) — the module's default view.
  return <Dashboard />;
}
