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
  ...overrides,
});

const meta = {
  title: 'Tasks/FolderNav',
  component: FolderNav,
  parameters: {
    layout: 'centered',
    // The sidebar reads folders + the flat item store; seed both so the due-count badges
    // render against real data (Work has 3 due today/overdue, Personal 1, Someday none).
    store: {
      folders: FOLDERS,
      tasks: [
        task({ id: 'a', folder_id: 'f1', due_date: dueYMD(-3) }),
        task({ id: 'b', folder_id: 'f1', due_date: dueYMD(-1) }),
        task({ id: 'c', folder_id: 'f1', due_date: dueYMD(0) }),
        task({ id: 'd', folder_id: 'f1', due_date: dueYMD(7) }), // future — not counted
        task({ id: 'e', folder_id: 'f2', due_date: dueYMD(0) }),
        task({ id: 'f', folder_id: 'f3', due_date: dueYMD(2) }), // future — not counted
      ],
    },
  },
} satisfies Meta<typeof FolderNav>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The sidebar with per-folder due-today/past-due badges: Work shows 3 (one past, one
 * yesterday, one today — the future one is excluded), Personal shows 1, Someday shows none.
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
