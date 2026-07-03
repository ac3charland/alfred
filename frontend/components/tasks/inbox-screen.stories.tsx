import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';

import type { ItemNode } from '@/lib/tree';

import { InboxScreen } from './inbox-screen';

/**
 * Wrap the screen in a fixed-width, auto-height frame so the visual snapshot is a tight,
 * deterministic crop (the screen's own `flex-1` + growing spacers would otherwise stretch to
 * the viewport height and swamp the content in empty space). One factory per width so the
 * desktop and mobile stories can each request their own.
 */
function withFrame(widthClass: string): Decorator {
  return (Story) => (
    <div data-testid="inbox-frame" className={`${widthClass} bg-background`}>
      <Story />
    </div>
  );
}

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
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
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
    // The inbox list is read from the TasksProvider store (seeded by the page);
    // seed it here so the revealed list shows tasks.
    store: { tasks: NODES },
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

/**
 * The revealed inbox at the desktop default viewport — capture box, the Inbox header row, and
 * the seeded task list — captured in a fixed-width frame for a deterministic crop.
 */
export const DesktopInbox: Story = {
  args: { open: true },
  decorators: [withFrame('w-[640px]')],
  parameters: {
    visualTest: { target: '[data-testid="inbox-frame"]' },
  },
};

/**
 * The same revealed inbox at a phone viewport (390×844): the capture box and task rows take the
 * full width and the rows adopt their `md:`-gated mobile card layout.
 */
export const MobileInbox: Story = {
  args: { open: true },
  decorators: [withFrame('w-[390px]')],
  parameters: {
    visualTest: { target: '[data-testid="inbox-frame"]', viewport: { width: 390, height: 844 } },
  },
};
