import { type RenderOptions, render } from '@testing-library/react';
import * as React from 'react';

import { ToastViewport } from '@/components/shell/toast-viewport';
import { ActiveEditorProvider } from '@/lib/stores/active-editor-store';
import { CodeProvider } from '@/lib/stores/code-store';
import { ExpansionProvider } from '@/lib/stores/expansion-store';
import { FoldersProvider } from '@/lib/stores/folders-store';
import { TasksProvider } from '@/lib/stores/tasks-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { CodeStory, Epic, Folder, Item, Project } from '@/lib/types';

/**
 * Render a component inside the alfred providers (FoldersProvider + TasksProvider +
 * ActiveEditorProvider + ExpansionProvider + CodeProvider + ToastProvider), seeded with
 * optional folders/tasks/projects/epics/stories. Components that read from the stores
 * (FolderNav, TaskRow, TaskList, CaptureBox, …) need this instead of a naked `render()`,
 * which would throw on the missing context. ToastProvider is here because the gate (TaskRow)
 * toasts the new ref on success; CodeProvider because the gate now reads the project/epic
 * lists from it (since ALF-27 the shell seeds it around the Tasks view too).
 */
interface ProviderRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  folders?: Folder[];
  tasks?: Item[];
  projects?: Project[];
  epics?: Epic[];
  stories?: CodeStory[];
}

export function renderWithProviders(
  ui: React.ReactElement,
  {
    folders = [],
    tasks = [],
    projects = [],
    epics = [],
    stories = [],
    ...options
  }: ProviderRenderOptions = {},
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ToastProvider>
        <FoldersProvider initialFolders={folders}>
          <TasksProvider initialTasks={tasks}>
            <ActiveEditorProvider>
              <ExpansionProvider>
                <CodeProvider
                  initialProjects={projects}
                  initialEpics={epics}
                  initialStories={stories}
                >
                  {children}
                </CodeProvider>
              </ExpansionProvider>
            </ActiveEditorProvider>
          </TasksProvider>
        </FoldersProvider>
        {/* The toast viewport (normally mounted in AppShell) so components that fire a
            toast — e.g. the gate in TaskRow — render their message under test. */}
        <ToastViewport />
      </ToastProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
