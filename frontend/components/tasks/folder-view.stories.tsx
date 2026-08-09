import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import { expect, userEvent, within } from 'storybook/test';

import { CodeProvider } from '@/lib/stores/code-store';
import { FolderSortProvider } from '@/lib/stores/folder-sort-store';
import type { Folder, Item } from '@/lib/types';

import { FolderView } from './folder-view';

/**
 * The two stores the shell seeds around this view that the global preview decorator doesn't:
 * the code store (task rows and the capture box read it) and each folder's sort choice.
 */
const withViewStores: Decorator = (Story) => (
  <CodeProvider initialProjects={[]} initialEpics={[]} initialStories={[]}>
    <FolderSortProvider>
      <Story />
    </FolderSortProvider>
  </CodeProvider>
);

const FOLDERS: Folder[] = [
  {
    id: 'f1',
    name: 'Work',
    created_at: '2025-01-01T00:00:00Z',
    sort_order: 1,
    description:
      'Anything for my employer: meetings, deliverables, admin, and the people I work with.',
  },
  {
    id: 'f2',
    name: 'Someday',
    created_at: '2025-01-02T00:00:00Z',
    sort_order: 2,
    description: null,
  },
];

/** Fixed residency stamp for a seeded FILED item — a fixture in a folder is one a human put there. */
const DISPATCHED_AT = '2025-01-02T00:00:00Z';

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
  folder_id: 'f1',
  dispatched_at: DISPATCHED_AT,
  parent_id: null,
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
  intended_epic_id: null,
  sort_order: 0,
  // Classifier provenance columns — flat defaults, nothing here has been classified.
  classified_at: null,
  classified_provider: null,
  classified_model: null,
  classified_prompt_version: null,
  classified_guess: null,
  classify_attempts: 0,
  ...overrides,
});

const WORK_TASKS: Item[] = [
  task({ id: 'a', title: 'Ship the Q3 deck', sort_order: 1 }),
  task({ id: 'b', title: 'Review the budget spreadsheet', sort_order: 2 }),
  task({ id: 'c', title: 'Call the vendor back', sort_order: 3 }),
];

const meta = {
  title: 'Tasks/FolderView',
  component: FolderView,
  decorators: [withViewStores],
  parameters: {
    layout: 'padded',
    // The view reads the folder from FoldersProvider and its rows from the flat item store.
    store: { folders: FOLDERS, tasks: WORK_TASKS },
  },
} satisfies Meta<typeof FolderView>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A folder with tasks, the capture box closed: the header's "+" sits left of Collapse-all, and
 * the folder's description sits on its own row beneath them.
 */
export const WithTasks: Story = {
  args: { folderId: 'f1' },
};

/** The description mid-edit: the line has been replaced in place by the textarea. */
export const DescriptionEditing: Story = {
  args: { folderId: 'f1' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', {
        name: 'Anything for my employer: meetings, deliverables, admin, and the people I work with.',
      }),
    );
    await expect(canvas.getByRole('textbox', { name: 'Edit folder description' })).toHaveValue(
      'Anything for my employer: meetings, deliverables, admin, and the people I work with.',
    );
  },
};

/** The same folder after pressing "+": the compact capture box sits between header and list. */
export const CaptureOpen: Story = {
  args: { folderId: 'f1' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Add task to Work' }));
    const field = await canvas.findByPlaceholderText('Add task…');
    await expect(field).toHaveFocus();
  },
};

/** An empty folder: its own description, plus the "Add task" way out of the empty state. */
export const EmptyFolder: Story = {
  args: { folderId: 'f2' },
};
