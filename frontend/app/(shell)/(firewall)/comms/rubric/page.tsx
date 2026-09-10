import * as React from 'react';

import { ModuleRouter } from '@/components/shell/module-router';

/**
 * The rubric editor (`/comms/rubric`). Renders the shared `ModuleRouter` like every other page
 * under `(shell)`, so a hard load or deep link server-renders the same view a client-side
 * switch would show.
 */
export default function CommsRubricPage() {
  return <ModuleRouter />;
}
