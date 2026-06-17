import * as React from 'react';

import { CodeView } from '@/components/code/code-view';

/**
 * Code landing route (`/code`). A thin shell, like the tasks pages: it renders the
 * shared client CodeView, which derives the view from the URL (the bare `/code` → the
 * landing) from the layout-seeded CodeProvider. Switching to a project board is then an
 * instant client-side URL change (see CodeView / ViewLink).
 */
export default function CodeLandingPage() {
  return <CodeView />;
}
