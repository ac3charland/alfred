import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * Reader landing route (`/reader`) — the reading list, the module's default view. Like every
 * page under `(shell)` it renders the shared `ModuleRouter`, which derives the module from the
 * URL and renders `ReaderView` from the shell-seeded providers; moving between the list and the
 * other Reader segments is then an instant client-side URL change (see ModuleRouter / ViewLink).
 */
export default function ReaderPage() {
  return <ModuleRouter />;
}
