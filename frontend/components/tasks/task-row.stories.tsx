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
    folders: [],
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

export const WithDueDate: Story = {
  args: {
    node: { ...BASE_NODE, due_date: '2099-06-30' },
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
    folders: [
      { id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z' },
      { id: 'f2', name: 'Personal', created_at: '2025-01-02T00:00:00Z' },
    ],
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

export const Completed: Story = {
  args: {
    node: {
      ...BASE_NODE,
      status: 'completed',
      completed_at: '2025-01-02T09:00:00Z',
    },
    isCompleted: true,
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
    isCompleted: true,
  },
};
