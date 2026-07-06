import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent, within } from 'storybook/test';

import type { ItemNode } from '@/lib/tree';

import { TaskRow } from './task-row';
import { taskListContainerClass } from './task-row.styles';

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
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
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

// A task row: the full task affordances (checkbox + add-subtask) and NO row pill — the
// "Task" badge was removed in ALF-67. This is BASE_NODE's type; spelled out for contrast.
export const TaskClassified: Story = {
  args: {
    node: { ...BASE_NODE, item_type: 'task', title: 'Write the first draft' },
  },
};

// A code-classified row: the "Code" badge (the one type that still earns a row pill), but
// still NO task affordances. (Notes stay generic — available via "Open details" on every type.)
export const CodeClassified: Story = {
  args: {
    node: { ...BASE_NODE, item_type: 'code', title: 'Build the webhook worker' },
  },
};

// A subtask row: title + affordances and NO "Task" pill (ALF-67 removed it everywhere).
export const Subtask: Story = {
  args: {
    node: { ...CHILD_NODE, title: 'Outline key sections' },
    depth: 1,
  },
};

// A subtask carrying its own priority: the level chip shows on the subtask row just like a
// top-level task's (ALF-63) — subtask priority is set on the detail panel and ranked in the
// Folder view, so it must be visible on the row too.
export const SubtaskWithPriority: Story = {
  args: {
    node: { ...CHILD_NODE, title: 'Outline key sections', priority: 'high' },
    depth: 1,
  },
};

// A task filed in a folder: no "Task" pill either (ALF-67). Rendered with its folder_id set;
// contrast with TaskClassified (Inbox).
export const TaskInFolder: Story = {
  args: {
    node: { ...BASE_NODE, title: 'Draft the project brief', folder_id: 'f1' },
  },
  parameters: {
    store: {
      folders: [{ id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z' }],
    },
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

// An ACTIVE parent with both an active and a completed child. The subtask-count badge
// (top-right) reads completed/total of the direct subtasks; expanding reveals the active child
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

// A long title that wraps to multiple lines, proving the controls remain visible.
// This story also serves as the primary visual-snapshot evidence for ALF-31.
export const LongTitle: Story = {
  args: {
    node: {
      ...BASE_NODE,
      item_type: 'task',
      due_date: '2099-12-31',
      title:
        'Coordinate the cross-functional review of the Q3 product roadmap and make sure all stakeholders have signed off on the final deliverable list before the all-hands',
    },
  },
  parameters: {
    visualTest: { target: '#storybook-root' },
  },
};

// A long unbroken string (no spaces) — exercises the break-words rule so the column
// wraps even when there are no natural word-break points.
export const LongTitleUnbroken: Story = {
  args: {
    node: {
      ...BASE_NODE,
      item_type: 'task',
      title:
        'https://www.example.com/really-long-path/to/some/deeply/nested/resource?query=value&other=value2&more=value3',
    },
  },
  parameters: {
    visualTest: { target: '#storybook-root' },
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

// ── Mobile card layout (ALF-86) ──

// A mobile grandchild, so the expanded card shows two levels of nesting inside one card.
const REUNION_GRANDCHILD: ItemNode = {
  ...BASE_NODE,
  id: 'm-gc1',
  title: 'Compare rental agencies',
  parent_id: 'm-sc1',
};

// An expanded top-level card ("Go to Charland reunion") whose subtasks — one carrying its own
// due / priority / count footer — sit INSIDE the card, a collapsed card with a count, and a
// long-title leaf whose badges drop to a footer so the title gets the card's full width.
const REUNION: ItemNode = {
  ...BASE_NODE,
  id: 'm-reunion',
  title: 'Go to Charland reunion',
  priority: 'high',
  children: [
    {
      ...BASE_NODE,
      id: 'm-sc1',
      title: 'Reserve rental car',
      parent_id: 'm-reunion',
      due_date: '2099-07-09',
      priority: 'medium',
      children: [REUNION_GRANDCHILD],
    },
    { ...BASE_NODE, id: 'm-sc2', title: 'Confirm the guest list', parent_id: 'm-reunion' },
  ],
};

const FB_ALERTS: ItemNode = {
  ...BASE_NODE,
  id: 'm-fb',
  title: 'Set up Facebook marketplace alerts',
  priority: 'medium',
  children: [
    { ...BASE_NODE, id: 'm-fb1', title: 'Pick search terms', parent_id: 'm-fb' },
    { ...BASE_NODE, id: 'm-fb2', title: 'Set price ceilings', parent_id: 'm-fb' },
    { ...BASE_NODE, id: 'm-fb3', title: 'Enable notifications', parent_id: 'm-fb' },
  ],
};

const LONG_LEAF: ItemNode = {
  ...BASE_NODE,
  id: 'm-long',
  title: 'Update monthly transfer amounts to account for daycare and the new mortgage',
  due_date: '2099-07-12',
  priority: 'high',
};

// The primary ALF-86 evidence: a phone-width list where each top-level task is its own card,
// the expanded card nests its subtasks inside, and every title takes the full width with its
// badges stacked into a footer below. The play fn opens the first card so the snapshot captures
// the nested subtree; the mobile viewport makes the `md:`-gated card styles take effect.
export const MobileCards: Story = {
  // `render` composes its own nodes below, so this arg only satisfies the required `node` prop.
  args: { node: REUNION },
  render: () => (
    <ul aria-label="Tasks" data-testid="tasks-mobile-frame" className={taskListContainerClass}>
      <TaskRow node={REUNION} />
      <TaskRow node={FB_ALERTS} />
      <TaskRow node={LONG_LEAF} />
    </ul>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Open the first card ("Go to Charland reunion") so its subtree renders inside the card.
    const [firstExpand] = canvas.getAllByRole('button', { name: 'Expand subtasks' });
    if (firstExpand) await userEvent.click(firstExpand);
  },
  parameters: {
    visualTest: {
      target: '[data-testid="tasks-mobile-frame"]',
      viewport: { width: 390, height: 844 },
    },
  },
};

// On mobile a row only reserves a leading column when it actually has that control, so titles
// shift left as the chevron and checkbox drop away — a staircase down these three cards:
//   1. a parent (has children + is a task) keeps BOTH the chevron and checkbox columns;
//   2. a childless task drops the chevron column but keeps the checkbox;
//   3. an unclassified inbox item has neither, so its title sits flush against the card edge.
// At md+ each dropped column becomes an invisible spacer again, so titles re-align (unchanged).
export const MobileColumnCollapse: Story = {
  // `render` composes its own nodes below; this arg only satisfies the required `node` prop.
  args: { node: BASE_NODE },
  render: () => (
    <ul aria-label="Tasks" data-testid="tasks-mobile-frame" className={taskListContainerClass}>
      <TaskRow
        node={{
          ...BASE_NODE,
          id: 'mcc-parent',
          title: 'Plan the team offsite',
          children: [
            { ...CHILD_NODE, id: 'mcc-child', parent_id: 'mcc-parent', title: 'Book the venue' },
          ],
        }}
      />
      <TaskRow
        node={{ ...BASE_NODE, id: 'mcc-leaf', title: 'Book the dentist', due_date: '2099-07-12' }}
      />
      <TaskRow
        node={{
          ...BASE_NODE,
          id: 'mcc-unclassified',
          item_type: 'unclassified',
          title: 'Look into weekend hiking trails',
        }}
      />
    </ul>
  ),
  parameters: {
    visualTest: {
      target: '[data-testid="tasks-mobile-frame"]',
      viewport: { width: 390, height: 844 },
    },
  },
};

// A long notes/description preview on a phone-width card clips to a single line with an
// ellipsis rather than spilling the card horizontally (ALF-99). The mobile viewport makes the
// `md:`-gated card layout take effect, where the fix (min-w-0 on the collapse grid item) is
// what keeps the nowrap preview bounded so `truncate` can ellipsize it.
export const MobileNotesTruncate: Story = {
  // `render` composes its own node below; this arg only satisfies the required `node` prop.
  args: { node: BASE_NODE },
  render: () => (
    <ul aria-label="Tasks" data-testid="tasks-mobile-frame" className={taskListContainerClass}>
      <TaskRow
        node={{
          ...BASE_NODE,
          id: 'm-notes',
          title: 'Research daycare options',
          notes:
            'Call the three centres near the office and compare their waitlists, hours, and monthly rates before the tour on Thursday afternoon.',
        }}
      />
    </ul>
  ),
  parameters: {
    visualTest: {
      target: '[data-testid="tasks-mobile-frame"]',
      viewport: { width: 390, height: 844 },
    },
  },
};

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
