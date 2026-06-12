import * as React from 'react';

import { TaskViews } from '@/components/tasks/task-views';

/**
 * Completed route (`/completed`).
 *
 * Renders the shared client view router, which derives the completed list from the
 * layout-seeded store. Reaching it from the sidebar is a client-side view switch (see
 * TaskViews / ViewLink), not an RSC navigation.
 */
export default function CompletedPage() {
  return <TaskViews />;
}
