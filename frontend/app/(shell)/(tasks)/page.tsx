import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * Landing + Inbox route (`/`).
 *
 * Like every page under `(shell)`, it renders the shared `ModuleRouter`, which reads the URL
 * (`?view=inbox`) and renders the right module's view from the shell-seeded stores — no
 * per-view fetch. Switching views or modules happens client-side via the History API (see
 * ModuleRouter / ViewLink).
 */
export default function InboxPage() {
  return <ModuleRouter />;
}
