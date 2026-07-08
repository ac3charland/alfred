import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { SearchBox } from '@/components/shell/search-box';
import { CodeProvider } from '@/lib/stores/code-store';
import { FoldersProvider } from '@/lib/stores/folders-store';
import { SearchProvider, useSearchActions } from '@/lib/stores/search-store';
import { TasksProvider } from '@/lib/stores/tasks-store';
import type { CodeStory, Folder, Item } from '@/lib/types';

const FOLDERS: Folder[] = [{ id: 'f1', name: 'Software', created_at: '2025-01-01T00:00:00Z' }];

const task = (overrides: Partial<Item>): Item => ({
  id: 'i1',
  title: 'Task',
  notes: null,
  source_url: null,
  item_type: 'task',
  created_at: '2025-01-01T00:00:00Z',
  raw_capture: null,
  due_date: null,
  status: 'active',
  completed_at: null,
  folder_id: null,
  parent_id: null,
  occurrence_index: null,
  priority: null,
  recurrence: null,
  recurrence_series_id: null,
  intended_project_id: null,
  ...overrides,
});

const TASKS: Item[] = [
  task({ id: 't1', title: 'Build the communication firewall triage UI', folder_id: 'f1' }),
  task({ id: 't2', title: 'Reply to firewall vendor email' }),
];

const STORY: CodeStory = {
  item_id: 's1',
  project_id: 'p1',
  epic_id: 'e1',
  ref_number: 31,
  ref: 'ALF-31',
  factory_state: 'ready_for_dev',
  lane: 'human',
  spec_path: null,
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  implementation_pr_url: null,
  blocked_reason: null,
  code_created_at: '2025-01-01T00:00:00Z',
  code_updated_at: '2025-01-01T00:00:00Z',
  title: 'Communication Firewall — message triage',
  notes: null,
  source_url: null,
  item_created_at: '2025-01-01T00:00:00Z',
  project_key: 'ALF',
  project_name: 'Alfred',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  epic_name: 'Firewall',
  epic_ref: 'ALF-1',
  epic_archived_at: null,
  priority: 1,
};

/** Seed the live query so the anchored dropdown renders with mixed results for the snapshot. */
function SeedQuery({ query }: { query: string }) {
  const { setQuery } = useSearchActions();
  React.useEffect(() => {
    setQuery(query);
  }, [setQuery, query]);
  return null;
}

const meta = {
  title: 'Shell/SearchBox',
  component: SearchBox,
  parameters: {
    layout: 'fullscreen',
    // The results panel is portaled to <body>, so capture the whole page, not just the field.
    visualTest: { target: 'body' },
  },
  decorators: [
    (Story) => (
      <FoldersProvider initialFolders={FOLDERS}>
        <TasksProvider initialTasks={TASKS}>
          <CodeProvider initialProjects={[]} initialEpics={[]} initialStories={[STORY]}>
            <SearchProvider>
              <SeedQuery query="firewall" />
              <div className="h-[420px] w-[760px] bg-background p-3">
                <Story />
              </div>
            </SearchProvider>
          </CodeProvider>
        </TasksProvider>
      </FoldersProvider>
    ),
  ],
  args: { placement: 'desktop', className: 'w-[420px]' },
} satisfies Meta<typeof SearchBox>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The top-bar field with its open results dropdown showing mixed Tasks + Stories matches. */
export const OpenWithResults: Story = {};
