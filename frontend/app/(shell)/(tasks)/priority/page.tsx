import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * By-Priority route (`/priority`).
 *
 * Like every page under `(shell)`, it renders the shared `ModuleRouter`, which derives the
 * By-Priority list from the shell-seeded store. Reaching it from the sidebar is a client-side
 * view switch (see ModuleRouter / ViewLink), not an RSC navigation; a hard load / deep link
 * still server-renders the same view.
 */
export default function PriorityPage() {
  return <ModuleRouter />;
}
