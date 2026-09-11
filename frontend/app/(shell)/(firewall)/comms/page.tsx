import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * Comms landing route (`/comms`) — the response queue, the module's default view. Like every
 * page under `(shell)` it renders the shared `ModuleRouter`, which derives the module from the
 * URL and renders `CommsView` from the shell-seeded stores; moving between the queue and the
 * settings pages is then an instant client-side URL change (see ModuleRouter / ViewLink).
 */
export default function CommsPage() {
  return <ModuleRouter />;
}
