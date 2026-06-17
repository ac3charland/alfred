import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * Project board route (`/code/[project-id]`). Like every page under `(shell)`, it renders the
 * shared `ModuleRouter`, which reads the project id from the URL and derives the board (epics
 * → swimlanes → cards) from the shell-seeded CodeProvider. No server fetch here — switching
 * projects or modules is instant (see ModuleRouter / ViewLink), and a hard deep-link load
 * resolves the same board server-side.
 */
export default function ProjectBoardPage() {
  return <ModuleRouter />;
}
