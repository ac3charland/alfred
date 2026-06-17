import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * Folder route (`/folders/[id]`).
 *
 * Like every page under `(shell)`, it renders the shared `ModuleRouter`, which reads the
 * folder id from the URL and derives the folder's view (name + scoped tasks) from the
 * shell-seeded stores. No server fetch here: an unknown id renders a client-side not-found
 * message, and navigating between folders (or modules) is instant (see ModuleRouter).
 */
export default function FolderPage() {
  return <ModuleRouter />;
}
