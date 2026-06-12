import { type RenderOptions, render } from '@testing-library/react';
import * as React from 'react';

import { ActiveEditorProvider } from '@/lib/stores/active-editor-store';
import { FoldersProvider } from '@/lib/stores/folders-store';
import { TasksProvider } from '@/lib/stores/tasks-store';
import type { Folder, Item } from '@/lib/types';

/**
 * Render a component inside the alfred providers (FoldersProvider + TasksProvider +
 * ActiveEditorProvider), seeded with optional folders/tasks. Components that read from
 * the stores (FolderNav, TaskRow, TaskList, CaptureBox, …) need this instead of a naked
 * `render()`, which would throw on the missing context.
 */
interface ProviderRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  folders?: Folder[];
  tasks?: Item[];
}

export function renderWithProviders(
  ui: React.ReactElement,
  { folders = [], tasks = [], ...options }: ProviderRenderOptions = {},
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <FoldersProvider initialFolders={folders}>
        <TasksProvider initialTasks={tasks}>
          <ActiveEditorProvider>{children}</ActiveEditorProvider>
        </TasksProvider>
      </FoldersProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
