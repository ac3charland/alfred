import * as React from 'react';

import { CodeView } from '@/components/code/code-view';

/**
 * Project board route (`/code/[project-id]`, §9.2). A thin shell, like the tasks pages: it
 * renders the shared client CodeView, which reads the project id from the URL and derives
 * the board (epics → swimlanes → cards) from the layout-seeded CodeProvider. No server
 * fetch here — switching projects is instant (see CodeView / ViewLink), and a hard
 * deep-link load resolves the same board server-side.
 */
export default function ProjectBoardPage() {
  return <CodeView />;
}
