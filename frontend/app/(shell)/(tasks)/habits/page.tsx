import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * Habits route (`/habits`).
 *
 * Like every page under `(shell)`, it renders the shared `ModuleRouter`, which derives the
 * habits view from the shell-seeded store. Reaching it from the sidebar or ⌘K is a client-side
 * view switch (see ModuleRouter / ViewLink), not an RSC navigation; a hard load / deep link
 * still server-renders the same view.
 */
export default function HabitsPage() {
  return <ModuleRouter />;
}
