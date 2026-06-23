'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Backlog } from '@/components/code/backlog';
import { Board } from '@/components/code/board';

const CODE_PREFIX = '/code/';
const BACKLOG_SEGMENT = 'backlog';

/**
 * Client-side view router for the Code module — the board's counterpart to `TaskViews`.
 *
 * Every code page renders this one component, which derives the active view purely from the
 * URL: a `/code/<projectId>` path shows that project's Board; the bare `/code` and the explicit
 * `/code/backlog` both show the cross-project Backlog (the default Code view, ALF-35). Because
 * it's the SAME mounted component on every code route and reads from the layout-seeded
 * CodeProvider, selecting a project or the Backlog via `ViewLink` (a History push, no RSC
 * round-trip) just re-derives the view. A hard load of any path renders the match server-side.
 */
export function CodeView() {
  const pathname = usePathname();

  if (pathname.startsWith(CODE_PREFIX)) {
    const segment = pathname.slice(CODE_PREFIX.length);
    // Guard the literal `backlog` segment so it is NOT treated as a project id — it isn't a
    // UUID, so <Board> would render "This project could not be found". An empty tail
    // (trailing slash) likewise falls through to the Backlog.
    if (segment.length > 0 && segment !== BACKLOG_SEGMENT) {
      return <Board projectId={segment} />;
    }
  }

  return <Backlog />;
}
