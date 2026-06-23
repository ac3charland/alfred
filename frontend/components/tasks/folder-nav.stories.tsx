import type { Meta, StoryObj } from '@storybook/nextjs';

import { FolderNav } from './folder-nav';

const meta = {
  title: 'Tasks/FolderNav',
  component: FolderNav,
  tags: ['autodocs'],
  parameters: {
    nextjs: { navigation: { pathname: '/folders/f1' } },
    store: {
      folders: [
        { id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z' },
        { id: 'f2', name: 'Personal', created_at: '2025-01-02T00:00:00Z' },
        { id: 'f3', name: 'Side projects', created_at: '2025-01-03T00:00:00Z' },
      ],
      tasks: [
        // Work: 3 past-due active tasks → badge shows "3"
        {
          id: 't1',
          title: 'Prepare quarterly report',
          notes: null,
          source_url: null,
          item_type: 'task',
          created_at: '2025-01-01T10:00:00Z',
          raw_capture: null,
          due_date: '2025-03-01',
          status: 'active',
          completed_at: null,
          folder_id: 'f1',
          parent_id: null,
        },
        {
          id: 't2',
          title: 'Review pull request',
          notes: null,
          source_url: null,
          item_type: 'task',
          created_at: '2025-01-01T10:00:00Z',
          raw_capture: null,
          due_date: '2025-04-15',
          status: 'active',
          completed_at: null,
          folder_id: 'f1',
          parent_id: null,
        },
        {
          id: 't3',
          title: 'Send meeting notes',
          notes: null,
          source_url: null,
          item_type: 'task',
          created_at: '2025-01-01T10:00:00Z',
          raw_capture: null,
          due_date: '2025-05-20',
          status: 'active',
          completed_at: null,
          folder_id: 'f1',
          parent_id: null,
        },
        // Personal: 1 past-due active task → badge shows "1"
        {
          id: 't4',
          title: 'Book dentist appointment',
          notes: null,
          source_url: null,
          item_type: 'task',
          created_at: '2025-01-01T10:00:00Z',
          raw_capture: null,
          due_date: '2025-06-01',
          status: 'active',
          completed_at: null,
          folder_id: 'f2',
          parent_id: null,
        },
        // Side projects: no qualifying tasks → no badge
        {
          id: 't5',
          title: 'Write blog post',
          notes: null,
          source_url: null,
          item_type: 'task',
          created_at: '2025-01-01T10:00:00Z',
          raw_capture: null,
          due_date: null,
          status: 'active',
          completed_at: null,
          folder_id: 'f3',
          parent_id: null,
        },
      ],
    },
  },
} satisfies Meta<typeof FolderNav>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Sidebar with due-count badges: Work shows 3, Personal shows 1, Side projects has no badge. */
export const WithDueBadges: Story = {};

/** Sidebar with no qualifying tasks — no badges rendered. */
export const NoBadges: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/' } },
    store: {
      folders: [
        { id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z' },
        { id: 'f2', name: 'Personal', created_at: '2025-01-02T00:00:00Z' },
      ],
      tasks: [],
    },
  },
};
