import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * Today route (`/today`).
 *
 * Like every page under `(shell)`, it renders the shared `ModuleRouter`, which derives the
 * due-today list from the shell-seeded store. Reaching it from the sidebar is a client-side
 * view switch (see ModuleRouter / ViewLink), not an RSC navigation; a hard load / deep link
 * still server-renders the same view.
 */
export default function TodayPage() {
  return <ModuleRouter />;
}
