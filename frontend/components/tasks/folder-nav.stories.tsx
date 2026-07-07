import type { Meta, StoryObj } from '@storybook/nextjs';

import type { Folder, Item } from '@/lib/types';

import { FolderNav } from './folder-nav';

/** A local YYYY-MM-DD due-date string offset from today (0 = today, -1 = yesterday). */
const dueYMD = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const FOLDERS: Folder[] = [
  { id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z' },
  { id: 'f2', name: 'Personal', created_at: '2025-01-02T00:00:00Z' },
  { id: 'f3', name: 'Someday', created_at: '2025-01-03T00:00:00Z' },
];

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
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
  ...overrides,
});

const meta = {
  title: 'Tasks/FolderNav',
  component: FolderNav,
  parameters: {
    layout: 'centered',
    // The sidebar reads folders + the flat item store; seed both so the two folder badges
    // render against real data. Work: 2 overdue (red) + 2 attention (today + a hi-pri no-due,
    // amber). Personal: 1 attention (today). Someday: nothing (a future low-pri task).
    store: {
      folders: FOLDERS,
      tasks: [
        task({ id: 'a', folder_id: 'f1', due_date: dueYMD(-3) }), // overdue
        task({ id: 'b', folder_id: 'f1', due_date: dueYMD(-1) }), // overdue
        task({ id: 'c', folder_id: 'f1', due_date: dueYMD(0) }), // due today → attention
        task({ id: 'g', folder_id: 'f1', priority: 'high', due_date: null }), // hi-pri → attention
        task({ id: 'd', folder_id: 'f1', due_date: dueYMD(7) }), // future low-pri — not counted
        task({ id: 'e', folder_id: 'f2', due_date: dueYMD(0) }), // due today → attention
        task({ id: 'f', folder_id: 'f3', due_date: dueYMD(2) }), // future — not counted
      ],
    },
  },
} satisfies Meta<typeof FolderNav>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The sidebar with per-folder badges: Work shows an amber attention badge (2 — one due today,
 * one high-priority no-due) plus a red overdue badge (2), Personal shows 1 attention, Someday
 * shows none (its only task is a future low-priority one).
 */
export const WithDueBadges: Story = {
  decorators: [
    (Story) => (
      <div className="w-64 rounded-md border border-border/50 bg-card p-2">
        <Story />
      </div>
    ),
  ],
};
