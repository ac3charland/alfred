'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { CodeView } from '@/components/code/code-view';
import { CommsView } from '@/components/comms/comms-view';
import { TaskViews } from '@/components/tasks/task-views';
import { activeModule } from '@/lib/modules';

/**
 * The shell's top-level module router — the cross-module counterpart to `TaskViews` /
 * `CodeView` / `CommsView`. EVERY page under `(shell)` renders this one component, which
 * derives the active module from the URL (`activeModule`) and renders that module's own view
 * router from the providers seeded once at the shared shell layout.
 *
 * Because all pages render the same URL-deriving component, it doesn't matter which server
 * route is mounted after a `history.pushState` from the switcher — the view follows the URL,
 * with no RSC round-trip (the same instant switch the in-module views already get). A hard
 * load / deep link / refresh of any path still server-renders the matching module, since the
 * matching page is mounted normally on first load.
 *
 * Tasks and Comms are both lists, so they share the centered, max-width column; the code board
 * spans the full width.
 */
export function ModuleRouter() {
  // Named `current`, not `module`: Next forbids assigning a variable called `module`, which
  // would shadow the CommonJS global in the compiled output.
  const current = activeModule(usePathname());

  if (current === 'code') {
    return <CodeView />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 flex-1 flex flex-col">
      {current === 'comms' ? <CommsView /> : <TaskViews />}
    </div>
  );
}
