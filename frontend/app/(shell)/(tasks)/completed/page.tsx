import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * Completed route (`/completed`).
 *
 * Like every page under `(shell)`, it renders the shared `ModuleRouter`, which derives the
 * completed list from the shell-seeded store. Reaching it from the sidebar is a client-side
 * view switch (see ModuleRouter / ViewLink), not an RSC navigation.
 */
export default function CompletedPage() {
  return <ModuleRouter />;
}
