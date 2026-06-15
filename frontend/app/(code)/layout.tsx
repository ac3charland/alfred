import * as React from 'react';

import CodeMobileNavClient from '@/app/(code)/mobile-nav';
import { ProjectNav } from '@/components/code/project-nav';
import { AppShell } from '@/components/shell/app-shell';
import { requireUser } from '@/lib/auth/require-user';
import { getCodeStories, getEpics, getProjects } from '@/lib/data/code';
import { CodeProvider } from '@/lib/stores/code-store';

/**
 * Code module layout (Server Component) — the Software Factory's route group (§9, §14).
 *
 * - Calls requireUser() as the real auth gate, exactly like the tasks layout.
 * - Fetches projects + epics + code stories once and seeds the CodeProvider for the whole
 *   module; the board derives each project's swimlanes client-side (the data-flow skill).
 * - Renders the shared AppShell (wordmark + Tasks⇄Code switcher + sign-out, §6) with the
 *   code-module nav: ProjectNav on desktop, the hamburger drawer on mobile.
 */
export default async function CodeLayout({ children }: { children: React.ReactNode }) {
  await requireUser();

  const [projects, epics, stories] = await Promise.all([
    getProjects(),
    getEpics(),
    getCodeStories(),
  ]);

  return (
    <CodeProvider initialProjects={projects} initialEpics={epics} initialStories={stories}>
      <AppShell nav={<ProjectNav />} mobileNav={<CodeMobileNavClient />}>
        {children}
      </AppShell>
    </CodeProvider>
  );
}
