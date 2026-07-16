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
 * URL: a `/code/<projectId>` path shows that project's Board; the bare `/code` and the explicit
 * `/code/backlog` both show the cross-project Backlog (the default Code view, ALF-35). Because
 * it's the SAME mounted component on every code route and reads from the layout-seeded
 * CodeProvider, selecting a project or the Backlog via `ViewLink` (a History push, no RSC
 * round-trip) just re-derives the view. A hard load of any path renders the match server-side.
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
    // The literal `needs-human-action` segment (ALF-103) is its own view, not a project id.
    if (segment === NEEDS_HUMAN_ACTION_SEGMENT) {
      return <NeedsHumanAction />;
    }
    // Guard the literal `backlog` segment so it is NOT treated as a project id — it isn't a
    // UUID, so <Board> would render "This project could not be found". An empty tail
    // (trailing slash) likewise falls through to the Backlog.
    if (segment.length > 0 && segment !== BACKLOG_SEGMENT) {
      return <Board projectId={segment} />;
    }
  }

  return <Backlog />;
}
