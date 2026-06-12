import * as React from 'react';

import { TaskViews } from '@/components/tasks/task-views';

/**
 * Landing + Inbox route (`/`).
 *
 * Renders the shared client view router, which reads the URL (`?view=inbox`) and
 * renders the inbox from the layout-seeded store — no per-view fetch. Switching to
 * other views happens client-side via the History API (see ViewLink / TaskViews).
 */
export default function InboxPage() {
  return <TaskViews />;
}
