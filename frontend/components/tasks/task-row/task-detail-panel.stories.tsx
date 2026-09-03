import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';

import { CodeProvider } from '@/lib/stores/code-store';
import type { ItemNode } from '@/lib/tree';
import type { Epic, Project } from '@/lib/types';

import { TaskDetailPanel } from './task-detail-panel';

const PROJECTS: Project[] = [
  {
    description: null,
    id: 'p-alf',
    name: 'Alfred',
    key: 'ALF',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    github_url: null,
    ref_seq: 0,
    created_at: '2025-01-01T00:00:00Z',
  },
];

const EPICS: Epic[] = [
  {
    id: 'e-104',
    project_id: 'p-alf',
    name: 'Inbox triage',
    notes: null,
    ref_number: 104,
    ref: 'ALF-104',
    archived_at: null,
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    created_at: '2025-01-01T00:00:00Z',
  },
];

/** The Folder / Project / Epic chips read the folders and code stores. */
const withCodeProvider: Decorator = (Story) => (
  <CodeProvider initialProjects={PROJECTS} initialEpics={EPICS} initialStories={[]}>
    <Story />
  </CodeProvider>
);

const BASE_NODE: ItemNode = {
  id: 'item-1',
  title: 'Call the dentist friday to reschedule the cleaning',
  notes: null,
  source_url: null,
  item_type: 'task',
  created_at: '2025-01-01T10:00:00Z',
  raw_capture: null,
  due_date: null,
  status: 'active',
  completed_at: null,
  folder_id: null,
  dispatched_at: null,
  parent_id: null,
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
  intended_epic_id: null,
  sort_order: 0,
  classified_at: null,
  classified_provider: null,
  classified_model: null,
  classified_prompt_version: null,
  classified_guess: null,
  classify_attempts: 0,
  weekly_plan_id: null,
  children: [],
};

const noop = () => {
  // Stories render the panel's states; the auto-save wiring belongs to TaskRow.
};

const meta = {
  title: 'Tasks/TaskDetailPanel',
  component: TaskDetailPanel,
  decorators: [
    withCodeProvider,
    (Story) => (
      <div data-testid="panel-frame" className="w-[560px] bg-background">
        <Story />
      </div>
    ),
  ],
  args: {
    metaLeft: '0rem',
    recurrence: null,
    onChangeRecurrence: noop,
    onSelectDueDate: noop,
    onClearDueDate: noop,
    onChangePriority: noop,
    onSetFolder: noop,
    onSetProject: noop,
    onSetEpic: noop,
    onCommitNotes: noop,
  },
  parameters: {
    store: {
      folders: [
        { id: 'f-health', name: 'Health', created_at: '2025-01-01T00:00:00Z', sort_order: 1 },
        { id: 'f-work', name: 'Work', created_at: '2025-01-01T00:00:00Z', sort_order: 2 },
      ],
    },
    visualTest: { target: '[data-testid="panel-frame"]' },
  },
} satisfies Meta<typeof TaskDetailPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A task's panel: Due · Repeat · Priority · Folder, each an auto-saving picker — the folder set
 * (teal), so the chip reads as a label the row carries while it is still in the Inbox. No Type
 * chip: the type is the ⋯ menu's, never the panel's.
 */
export const TaskFields: Story = {
  args: {
    node: {
      ...BASE_NODE,
      // Far-future literal (matches task-row.stories.tsx's convention) so the chip always renders
      // the absolute "Aug 7" label — a date near today would flip to a relative "Today"/"Tomorrow"/
      // "Yesterday" label depending on which day the suite happens to run.
      due_date: '2099-08-07',
      priority: 'high',
      folder_id: 'f-health',
    },
    isTask: true,
    isCode: false,
    showRepeat: true,
  },
};

/**
 * A code item carrying both pre-factory hints: the whole chip row is Project · Epic, each in
 * the project's palette colour — the epic's ref in mono, as `ProjectKeyChip` sets a key.
 */
export const CodeFields: Story = {
  args: {
    node: {
      ...BASE_NODE,
      title: 'Alfred should let me snooze an item until next week',
      item_type: 'code',
      intended_project_id: 'p-alf',
      intended_epic_id: 'e-104',
    },
    isTask: false,
    isCode: true,
    showRepeat: false,
  },
};

/**
 * The same code panel with nothing set: both chips neutral, and Epic dimmed and
 * non-interactive with its "Pick a project first" hint — the epic list derives from the
 * project, exactly as in the gate.
 */
export const CodeFieldsEmpty: Story = {
  args: {
    node: {
      ...BASE_NODE,
      title: 'Alfred should let me snooze an item until next week',
      item_type: 'code',
    },
    isTask: false,
    isCode: true,
    showRepeat: false,
  },
};
