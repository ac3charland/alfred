import type { Preview } from '@storybook/nextjs';
import React from 'react';

import '../app/globals.css';
import { ActiveEditorProvider } from '../lib/stores/active-editor-store';
import { CodeFilterProvider } from '../lib/stores/code-filter-store';
import { ExpansionProvider } from '../lib/stores/expansion-store';
import { FoldersProvider } from '../lib/stores/folders-store';
import { InboxSelectionProvider } from '../lib/stores/inbox-selection-store';
import { TasksProvider } from '../lib/stores/tasks-store';
import { ToastProvider } from '../lib/stores/toast-store';
import type { Folder, Item } from '../lib/types';

/** Per-story seeds for the data providers, set via `parameters.store`. */
interface StoreSeed {
  folders?: Folder[];
  tasks?: Item[];
}

const preview: Preview = {
  decorators: [
    (Story, context) => {
      const seed = (context.parameters as { store?: StoreSeed }).store ?? {};
      // Every story renders inside the data providers so components that read the
      // stores (FolderNav, TaskRow, TaskList, CaptureBox) work without boilerplate.
      // ToastProvider is included because TaskRow fires a toast from the gate.
      return React.createElement(
        ToastProvider,
        null,
        React.createElement(
          FoldersProvider,
          { initialFolders: seed.folders ?? [] },
          React.createElement(
            TasksProvider,
            { initialTasks: seed.tasks ?? [] },
            React.createElement(
              ActiveEditorProvider,
              null,
              React.createElement(
                ExpansionProvider,
                null,
                React.createElement(
                  InboxSelectionProvider,
                  null,
                  // CodeFilterProvider mirrors the shell layout: a server-data-free coordination
                  // store the Backlog/board views read for their persisted status filter.
                  React.createElement(
                    CodeFilterProvider,
                    null,
                    React.createElement(
                      'div',
                      { className: 'dark min-h-screen bg-background text-foreground p-8' },
                      React.createElement(Story),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    },
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /date$/i,
      },
    },
    nextjs: {
      appDirectory: true,
    },
  },
};

export default preview;
