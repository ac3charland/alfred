import { type RenderOptions, render } from '@testing-library/react';
import * as React from 'react';

import { FoldersProvider } from '@/lib/stores/folders-store';
import { TasksProvider } from '@/lib/stores/tasks-store';
import type { ItemNode } from '@/lib/tree';
import type { Folder } from '@/lib/types';

/**
 * Render a component inside the alfred data providers (FoldersProvider +
 * TasksProvider), seeded with optional folders/tasks. Components that read from the
 * stores (FolderNav, TaskRow, TaskList, CaptureBox, …) need this instead of a naked
 * `render()`, which would throw on the missing context.
 */
interface ProviderRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  folders?: Folder[];
  tasks?: ItemNode[];
}

export function renderWithProviders(
  ui: React.ReactElement,
  { folders = [], tasks = [], ...options }: ProviderRenderOptions = {},
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <FoldersProvider initialFolders={folders}>
        <TasksProvider initialTasks={tasks}>{children}</TasksProvider>
      </FoldersProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
