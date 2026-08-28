'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Backlog } from '@/components/code/backlog';
import { Board } from '@/components/code/board';
import { NeedsHumanAction } from '@/components/code/needs-human-action';
import { useCodeActions } from '@/lib/stores/code-store';

const CODE_PREFIX = '/code/';
const BACKLOG_SEGMENT = 'backlog';
const NEEDS_HUMAN_ACTION_SEGMENT = 'needs-human-action';

/**
 * Client-side view router for the Code module — the board's counterpart to `TaskViews`.
 *
 * Every code page renders this one component, which derives the active view purely from the
 * URL: a `/code/<projectId>` path shows that project's Board; the explicit `/code/backlog` shows
 * the cross-project Backlog; and the bare `/code` and `/code/needs-human-action` both show the
 * "Needs human action" queue — the module's DEFAULT view (ALF-174, taking the default over from
 * the Backlog, ALF-35). Entering the module should open on the work that is actually blocked on
 * the owner, not the full ranked backlog. Because it's the SAME mounted component on every code
 * route and reads from the layout-seeded CodeProvider, selecting a project or another queue via
 * `ViewLink` (a History push, no RSC round-trip) just re-derives the view. A hard load of any
 * path renders the match server-side.
 *
 * The seed-once store means statuses can drift after a long-lived session (a realtime UPDATE
 * dropped by a stale connection, a move that landed while the tab was backgrounded). So on every
 * navigation to a board or the Backlog — keyed on `pathname`, which also covers entry to the
 * module — refetch and reconcile the ticket statuses (ALF-69). `refreshStatuses` is stable and
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
    // The literal `backlog` segment is its own view, not a project id — it isn't a UUID, so
    // <Board> would render "This project could not be found".
    if (segment === BACKLOG_SEGMENT) {
      return <Backlog />;
    }
    // Same guard for the literal `needs-human-action` segment (ALF-103). An empty tail (a
    // trailing slash) likewise falls through to the default view below.
    if (segment.length > 0 && segment !== NEEDS_HUMAN_ACTION_SEGMENT) {
      return <Board projectId={segment} />;
    }
  }

  return <NeedsHumanAction />;
}
