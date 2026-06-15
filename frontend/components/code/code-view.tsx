'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Board } from '@/components/code/board';
import { CodeLanding } from '@/components/code/code-landing';

const CODE_PREFIX = '/code/';

/**
 * Client-side view router for the Code module — the §9 board's counterpart to `TaskViews`.
 *
 * Both code pages (the landing `/code` and a board `/code/[project-id]`) render this one
 * component, which derives the active view purely from the URL: a `/code/<id>` path shows
 * that project's Board, the bare `/code` shows the landing. Because it's the SAME mounted
 * component on both routes and reads from the layout-seeded CodeProvider, selecting a
 * project via `ViewLink` (a History push, no RSC round-trip) just re-derives the board —
 * the same instant client switch the tasks views get. A hard load of either path renders
 * the matching view server-side too.
 */
export function CodeView() {
  const pathname = usePathname();

  if (pathname.startsWith(CODE_PREFIX)) {
    const projectId = pathname.slice(CODE_PREFIX.length);
    // Guard the empty tail (`/code/`) so a trailing slash falls back to the landing.
    if (projectId.length > 0) {
      return <Board projectId={projectId} />;
    }
  }

  return <CodeLanding />;
}
