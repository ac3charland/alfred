'use client';

import * as React from 'react';

/**
 * Whether this deployment can research a question — the one piece of the research feature's
 * configuration the browser sees. The fire token and the delivery key stay server-side
 * (`lib/research/config.ts`); the shell layout computes the flag there and seeds it here. Off, the
 * Inbox offers no Research anywhere and a classifier-labelled research row reads "research not
 * connected".
 *
 * A context of its own rather than a field on a store: the tasks store (readiness), both Classify
 * menus and the Reader (Retry) all read it, and it never changes while the page is open.
 */
const ResearchConfigContext = React.createContext<boolean | undefined>(undefined);

export function ResearchConfigProvider({
  configured,
  children,
}: {
  configured: boolean;
  children: React.ReactNode;
}) {
  return <ResearchConfigContext value={configured}>{children}</ResearchConfigContext>;
}

/** Whether research is configured on this deployment. Throws outside a ResearchConfigProvider. */
export function useResearchConfigured(): boolean {
  const configured = React.useContext(ResearchConfigContext);
  if (configured === undefined) {
    throw new Error('useResearchConfigured must be used within a ResearchConfigProvider');
  }
  return configured;
}
