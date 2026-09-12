import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * Dashboard route (`/code/dashboard`). Like every page under `(shell)`, it renders the shared
 * `ModuleRouter`, which derives the Code module from the URL and renders the Dashboard from the
 * shell-seeded CodeProvider. A real static segment so it deep-links/hard-loads server-side and
 * wins precedence over the sibling `[project-id]` dynamic route in the App Router.
 */
export default function DashboardPage() {
  return <ModuleRouter />;
}
