import * as React from 'react';

import { TaskViews } from '@/components/tasks/task-views';

/**
 * Folder route (`/folders/[id]`).
 *
 * Renders the shared client view router, which reads the folder id from the URL and
 * derives the folder's view (name + scoped tasks) from the layout-seeded stores. No
 * server fetch here: an unknown id renders a client-side not-found message, and
 * navigating between folders is instant (see TaskViews / ViewLink).
 */
export default function FolderPage() {
  return <TaskViews />;
}
