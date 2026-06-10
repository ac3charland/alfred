import type { Meta, StoryObj } from '@storybook/nextjs';

import type { ItemNode } from '@/lib/tree';

import { InboxScreen } from './inbox-screen';

const BASE_NODE: ItemNode = {
  id: 'item-1',
  title: 'Draft the launch announcement',
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

const NODES: ItemNode[] = [
  BASE_NODE,
  {
    ...BASE_NODE,
    id: 'item-2',
    title: 'Reply to the recruiter',
    created_at: '2025-01-01T09:00:00Z',
  },
];

const meta = {
  title: 'Tasks/InboxScreen',
  component: InboxScreen,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    nodes: NODES,
    folders: [],
  },
} satisfies Meta<typeof InboxScreen>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The bare landing screen: capture box + a subtle "View inbox" link, no items. */
export const Landing: Story = {
  args: {
    open: false,
  },
};

/** The inbox revealed: the task list fades in below the capture box. */
export const Inbox: Story = {
  args: {
    open: true,
  },
};
