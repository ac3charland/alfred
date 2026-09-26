import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * Every Wiki route — `/wiki`, `/wiki/<section>` and `/wiki/<section>/<name>` — served by one
 * optional catch-all, since the module's own view router (`WikiView`) derives the view from the
 * URL. Like every page under `(shell)` it renders the shared `ModuleRouter`, so a hard load or a
 * deep link server-renders the same view a client-side switch would show.
 */
export default function WikiPage() {
  return <ModuleRouter />;
}
