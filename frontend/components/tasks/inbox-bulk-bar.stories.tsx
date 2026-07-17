import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { useInboxSelectionActions } from '@/lib/stores/inbox-selection-store';
import type { Folder, Item } from '@/lib/types';

import { InboxBulkBar } from './inbox-bulk-bar';

const BASE: Item = {
  id: 'item-1',
  title: 'A captured thought',
  notes: null,
  source_url: null,
  item_type: 'unclassified',
  created_at: '2025-01-01T10:00:00Z',
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
  sort_order: 0,
};

function makeItem(id: string, overrides: Partial<Item> = {}): Item {
  return { ...BASE, id, ...overrides };
}

const FOLDERS: Folder[] = [{ id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z' }];

const UNCLASSIFIED: Item[] = [
  makeItem('u1', { title: 'Email the accountant about Q2' }),
  makeItem('u2', { title: 'Draft the onboarding doc' }),
  makeItem('u3', { title: 'Spike: websocket reconnection' }),
];
const TASKS: Item[] = [
  makeItem('t1', { title: 'Buy a new laptop charger', item_type: 'task' }),
  makeItem('t2', { title: 'Renew the domain', item_type: 'task' }),
];
const MIXED: Item[] = [
  makeItem('m1', { title: 'Unclassified capture' }),
  makeItem('m2', { title: 'A classified task', item_type: 'task' }),
];

/**
 * Render the bar with select mode forced on and a fixed set selected — the bar only renders
 * when active and non-empty, so the story enters that state on mount.
 */
function SelectedBar({ ids }: { ids: string[] }) {
  const { enter, toggle } = useInboxSelectionActions();
  React.useEffect(() => {
    enter();
    for (const id of ids) toggle(id);
  }, [enter, toggle, ids]);
  return <InboxBulkBar />;
}

const meta = {
  title: 'Tasks/InboxBulkBar',
  component: InboxBulkBar,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof InboxBulkBar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** All-unclassified selection: Classify live, Move disabled (task-only), Send-to-Code live. */
export const AllUnclassified: Story = {
  parameters: { store: { tasks: UNCLASSIFIED, folders: FOLDERS } },
  render: () => <SelectedBar ids={['u1', 'u2', 'u3']} />,
};

/** All-task selection: Move live, Classify disabled (unclassified-only). */
export const AllTasks: Story = {
  parameters: { store: { tasks: TASKS, folders: FOLDERS } },
  render: () => <SelectedBar ids={['t1', 't2']} />,
};

/** Mixed selection: both type-coherent actions disabled; only Send-to-Code stays live. */
export const Mixed: Story = {
  parameters: { store: { tasks: MIXED, folders: FOLDERS } },
  render: () => <SelectedBar ids={['m1', 'm2']} />,
};

/** A single item selected — the count reads "1 selected". */
export const SingleSelected: Story = {
  parameters: { store: { tasks: UNCLASSIFIED, folders: FOLDERS } },
  render: () => <SelectedBar ids={['u1']} />,
};
