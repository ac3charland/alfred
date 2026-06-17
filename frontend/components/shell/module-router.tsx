'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { CodeView } from '@/components/code/code-view';
import { TaskViews } from '@/components/tasks/task-views';
import { isCodePath } from '@/lib/modules';

/**
 * The shell's top-level module router — the cross-module counterpart to `TaskViews` /
 * `CodeView`. EVERY page under `(shell)` renders this one component, which derives the
 * active module from the URL (`isCodePath`) and renders that module's own view router from
 * the providers seeded once at the shared shell layout.
 *
 * Because all pages render the same URL-deriving component, it doesn't matter which server
 * route is mounted after a `history.pushState` from the switcher — the view follows the URL,
 * with no RSC round-trip (the same instant switch the in-module views already get). A hard
 * load / deep link / refresh of any path still server-renders the matching module, since the
 * matching page is mounted normally on first load.
 *
 * Tasks views keep their centered, max-width column (previously owned by the tasks layout);
 * the code board spans the full width.
 */
export function ModuleRouter() {
  const pathname = usePathname();

  if (isCodePath(pathname)) {
    return <CodeView />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 flex-1 flex flex-col">
      <TaskViews />
    </div>
  );
}
