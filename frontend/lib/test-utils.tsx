import { type RenderOptions, render } from '@testing-library/react';
import * as React from 'react';

import { ToastViewport } from '@/components/shell/toast-viewport';
import type { HabitStats } from '@/lib/habits';
import { ActiveEditorProvider } from '@/lib/stores/active-editor-store';
import { CodeFilterProvider } from '@/lib/stores/code-filter-store';
import { CodeProvider } from '@/lib/stores/code-store';
import { DepartingItemsProvider } from '@/lib/stores/departing-items-store';
import { ExpansionProvider } from '@/lib/stores/expansion-store';
import { FolderSortProvider } from '@/lib/stores/folder-sort-store';
import { FoldersProvider } from '@/lib/stores/folders-store';
import { HabitsProvider } from '@/lib/stores/habits-store';
import { InboxSelectionProvider } from '@/lib/stores/inbox-selection-store';
import { TasksProvider } from '@/lib/stores/tasks-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import { WeeklyPlanProvider } from '@/lib/stores/weekly-plan-store';
import type {
  CodeStory,
  Epic,
  Folder,
  Habit,
  HabitEntry,
  Item,
  Project,
  WeeklyPlan,
  WeeklyPlanSummary,
} from '@/lib/types';

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
  /** The weekly plan archive: the picker index plus the latest plan's document. */
  weeklyPlans?: { index: WeeklyPlanSummary[]; latest: WeeklyPlan | undefined };
  /**
   * The habit definitions, their logged days, and the date the store treats as today.
   * `stats` are the server's all-history baselines; leaving them out takes the same path a
   * habit created in-session does, where the window walk is the whole truth.
   */
  habits?: {
    habits: Habit[];
    entries: HabitEntry[];
    today: string;
    stats?: Record<string, HabitStats>;
  };
}

export function renderWithProviders(
  ui: React.ReactElement,
  {
    folders = [],
    tasks = [],
    projects = [],
    epics = [],
    stories = [],
    weeklyPlans = { index: [], latest: undefined },
    habits = { habits: [], entries: [], today: '2026-07-28' },
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
                <InboxSelectionProvider>
                  <DepartingItemsProvider>
                    <CodeProvider
                      initialProjects={projects}
                      initialEpics={epics}
                      initialStories={stories}
                    >
                      <CodeFilterProvider>
                        <FolderSortProvider>
                          <WeeklyPlanProvider
                            initialIndex={weeklyPlans.index}
                            initialLatest={weeklyPlans.latest}
                          >
                            <HabitsProvider
                              initialHabits={habits.habits}
                              initialEntries={habits.entries}
                              initialStats={habits.stats ?? {}}
                              serverToday={habits.today}
                            >
                              {children}
                            </HabitsProvider>
                          </WeeklyPlanProvider>
                        </FolderSortProvider>
                      </CodeFilterProvider>
                    </CodeProvider>
                  </DepartingItemsProvider>
                </InboxSelectionProvider>
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
