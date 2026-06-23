import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * Backlog route (`/code/backlog`). Like every page under `(shell)`, it renders the shared
 * `ModuleRouter`, which derives the Code module from the URL and renders the cross-project
 * Backlog (the default Code view) from the shell-seeded CodeProvider. A real static segment so
 * it deep-links/hard-loads server-side and wins precedence over the sibling `[project-id]`
 * dynamic route in the App Router.
 */
export default function BacklogPage() {
  return <ModuleRouter />;
}
