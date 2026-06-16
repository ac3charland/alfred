import type { Meta, StoryObj } from '@storybook/nextjs';

import type { ItemNode } from '@/lib/tree';

import { TaskRow } from './task-row';

const BASE_NODE: ItemNode = {
  id: 'item-1',
  title: 'Write the first draft',
  notes: null,
  source_url: null,
  item_type: 'task',
  created_at: '2025-01-01T10:00:00Z',
  raw_capture: null,
  due_date: null,
  status: 'active',
  completed_at: null,
  folder_id: null,
  parent_id: null,
  children: [],
};

const CHILD_NODE: ItemNode = {
  ...BASE_NODE,
  id: 'item-2',
  title: 'Outline key sections',
  parent_id: 'item-1',
  created_at: '2025-01-01T11:00:00Z',
  children: [],
};

const GRANDCHILD_NODE: ItemNode = {
  ...BASE_NODE,
  id: 'item-3',
  title: 'List references',
  parent_id: 'item-2',
  created_at: '2025-01-01T12:00:00Z',
  children: [],
};

const meta = {
  title: 'Tasks/TaskRow',
  component: TaskRow,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
  args: {
    depth: 0,
  },
} satisfies Meta<typeof TaskRow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Simple: Story = {
  args: {
    node: BASE_NODE,
  },
};

// ── Classification variants — the type-gating matrix made visible. ──

// An unclassified row (what capture creates): no type badge, no completion checkbox, no
// add-subtask affordance — just the title. Classifying it unlocks those (see below).
export const Unclassified: Story = {
  args: {
    node: { ...BASE_NODE, item_type: 'unclassified', title: 'Triage this thought' },
  },
};

// A task row: the "Task" badge plus the full task affordances (checkbox + due date +
// subtasks). This is BASE_NODE's type; spelled out here for the contrast with the others.
export const TaskClassified: Story = {
  args: {
    node: { ...BASE_NODE, item_type: 'task', title: 'Write the first draft' },
  },
};

// A code-classified row: the "Code" badge, but still NO task affordances. (Notes stay
// generic — available via the actions menu on every type.)
export const CodeClassified: Story = {
  args: {
    node: { ...BASE_NODE, item_type: 'code', title: 'Build the webhook worker' },
  },
};

export const WithDueDate: Story = {
  args: {
    node: { ...BASE_NODE, due_date: '2099-06-30' },
  },
};

// Story used by the timezone-fix demo: a task due exactly today, which was displayed
// one day early in negative-UTC timezones (CDT) before parseDueDate() was added.
export const DueDateToday: Story = {
  args: {
    node: { ...BASE_NODE, due_date: '2026-06-16' },
  },
};

export const WithNotes: Story = {
  args: {
    node: { ...BASE_NODE, notes: 'Check the style guide before starting.' },
  },
};

export const WithChildren: Story = {
  args: {
    node: { ...BASE_NODE, children: [CHILD_NODE] },
  },
};

export const DeepNesting: Story = {
  args: {
    node: {
      ...BASE_NODE,
      children: [{ ...CHILD_NODE, children: [GRANDCHILD_NODE] }],
    },
    depth: 1,
  },
};

export const WithFolders: Story = {
  args: {
    node: BASE_NODE,
  },
  parameters: {
    store: {
      folders: [
        { id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z' },
        { id: 'f2', name: 'Personal', created_at: '2025-01-02T00:00:00Z' },
      ],
    },
  },
};

export const WithAllMetadata: Story = {
  args: {
    node: {
      ...BASE_NODE,
      due_date: '2099-07-15',
      notes: 'Coordinate with design team on visuals.',
      children: [CHILD_NODE],
    },
  },
};

// An ACTIVE parent with both an active and a completed child. The completed descendants
// badge (top-right) counts all completed descendants; expanding reveals the active child
// plus a "Show completed (N)" toggle that unhides the completed ones.
export const WithCompletedChildren: Story = {
  args: {
    node: {
      ...BASE_NODE,
      children: [
        CHILD_NODE,
        {
          ...CHILD_NODE,
          id: 'item-2b',
          title: 'Lock the date',
          status: 'completed',
          completed_at: '2025-01-02T09:00:00Z',
          created_at: '2025-01-01T09:00:00Z',
        },
      ],
    },
  },
};

export const Completed: Story = {
  args: {
    node: {
      ...BASE_NODE,
      status: 'completed',
      completed_at: '2025-01-02T09:00:00Z',
    },
    isCompletedView: true,
  },
};

export const CompletedWithChildren: Story = {
  args: {
    node: {
      ...BASE_NODE,
      status: 'completed',
      completed_at: '2025-01-02T09:00:00Z',
      children: [{ ...CHILD_NODE, status: 'completed', completed_at: '2025-01-02T09:00:00Z' }],
    },
    isCompletedView: true,
  },
};

// A completed root item shows its parent folder (or "Inbox") in low-contrast text
// beneath the title, prefixed with the list-check icon — the Completed-screen context label.
export const CompletedInFolder: Story = {
  args: {
    node: {
      ...BASE_NODE,
      title: 'Ship the onboarding email',
      status: 'completed',
      completed_at: '2025-01-02T09:00:00Z',
      folder_id: 'f1',
    },
    isCompletedView: true,
  },
  parameters: {
    store: {
      folders: [{ id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z' }],
    },
  },
};

// A → B → C → D → E → F: the active ancestor chain (filtered out of the completed view),
// seeded into the store so the completed leaf "G" can render its full breadcrumb.
const ANCESTOR_CHAIN: ItemNode[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((title, index) => ({
  ...BASE_NODE,
  id: `chain-${String(index)}`,
  title,
  parent_id: index === 0 ? null : `chain-${String(index - 1)}`,
  children: [],
}));

// A deeply nested completed item shows every ancestor, oldest → youngest, joined by " > ".
export const CompletedNested: Story = {
  args: {
    node: {
      ...BASE_NODE,
      title: 'Finalize the launch checklist',
      status: 'completed',
      completed_at: '2025-01-02T09:00:00Z',
      parent_id: 'chain-5',
    },
    isCompletedView: true,
  },
  parameters: {
    store: {
      tasks: ANCESTOR_CHAIN,
    },
  },
};
