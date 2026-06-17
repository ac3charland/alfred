import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * Code landing route (`/code`). Like every page under `(shell)`, it renders the shared
 * `ModuleRouter`, which derives the Code module from the URL and renders `CodeView` (the bare
 * `/code` → the landing) from the shell-seeded CodeProvider. Switching to a project board, or
 * back to Tasks, is then an instant client-side URL change (see ModuleRouter / ViewLink).
 */
export default function CodeLandingPage() {
  return <ModuleRouter />;
}
