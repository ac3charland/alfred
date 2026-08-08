import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { CodeProvider } from '@/lib/stores/code-store';
import { useInboxSelectionActions } from '@/lib/stores/inbox-selection-store';
import type { Epic, Folder, Item, Project } from '@/lib/types';

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
  dispatched_at: null,
  parent_id: null,
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
  intended_epic_id: null,
  sort_order: 0,
};

function makeItem(id: string, overrides: Partial<Item> = {}): Item {
  return { ...BASE, id, ...overrides };
}

const FOLDERS: Folder[] = [
  { description: null, id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z', sort_order: 1 },
];

const PROJECTS: Project[] = [
  {
    description: null,
    id: 'p1',
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
    id: 'e1',
    project_id: 'p1',
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

/** Dispatch routes code items through the code store's gate action, so the bar needs it seeded. */
const withCodeProvider: Decorator = (Story) => (
  <CodeProvider initialProjects={PROJECTS} initialEpics={EPICS} initialStories={[]}>
    <Story />
  </CodeProvider>
);

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
  decorators: [withCodeProvider],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof InboxBulkBar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** All-unclassified selection: nothing dispatch-ready, Classify/Move/Send all live. */
export const AllUnclassified: Story = {
  parameters: { store: { tasks: UNCLASSIFIED, folders: FOLDERS } },
  render: () => <SelectedBar ids={['u1', 'u2', 'u3']} />,
};

/** All-task selection: Move live, Classify live too (childless roots carry a type to correct). */
export const AllTasks: Story = {
  parameters: { store: { tasks: TASKS, folders: FOLDERS } },
  render: () => <SelectedBar ids={['t1', 't2']} />,
};

/** Mixed unclassified + task selection: every action live (all childless roots, all fileable). */
export const Mixed: Story = {
  parameters: { store: { tasks: MIXED, folders: FOLDERS } },
  render: () => <SelectedBar ids={['m1', 'm2']} />,
};

/** A single item selected — the count reads "1 selected". */
export const SingleSelected: Story = {
  parameters: { store: { tasks: UNCLASSIFIED, folders: FOLDERS } },
  render: () => <SelectedBar ids={['u1']} />,
};

/**
 * A mixed selection mid-triage (ALF-170): a ready task (labelled with a folder), a ready code
 * item (both hints set), and a bare task that isn't ready. Dispatch leads the bar teal-filled
 * and enabled, and the readiness line beneath the actions names what the unready row is
 * missing — before the press, not as a post-mortem.
 */
export const DispatchWithReadinessLine: Story = {
  parameters: {
    store: {
      tasks: [
        makeItem('d1', {
          title: 'Call the dentist to reschedule',
          item_type: 'task',
          folder_id: 'f1',
          dispatched_at: null,
        }),
        makeItem('d2', {
          title: 'Alfred should let me snooze an item',
          item_type: 'code',
          intended_project_id: 'p1',
          intended_epic_id: 'e1',
        }),
        makeItem('d3', { title: 'Book the van for the move', item_type: 'task' }),
      ],
      folders: FOLDERS,
    },
  },
  render: () => <SelectedBar ids={['d1', 'd2', 'd3']} />,
};

/** Nothing in the selection is ready: Dispatch disables with its hint, the line explains why. */
export const NothingReady: Story = {
  parameters: { store: { tasks: UNCLASSIFIED, folders: FOLDERS } },
  render: () => <SelectedBar ids={['u1', 'u2']} />,
};
